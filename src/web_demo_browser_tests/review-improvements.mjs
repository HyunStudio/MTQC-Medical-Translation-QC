import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.MTQC_REVIEW_APP_DIR || path.resolve(here, '../web_demo');
const dll = path.join(appDir, 'bin/Debug/net10.0/MedicalQcWebDemo.dll');
const chrome = [process.env.CHROME_PATH, path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe')].find(value => value && existsSync(value));
assert(chrome, 'Chrome required');
if (!process.env.MTQC_SKIP_TEST_BUILD) {
  assert.equal(spawnSync('dotnet', ['build', path.join(appDir, 'MedicalQcWebDemo.csproj'), '--nologo'], {stdio:'inherit'}).status, 0);
}
for (const asset of ['app.js','document-workbench.js','index.html']) {
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(await readFile(path.join(appDir,'wwwroot',asset))),
    digest(await readFile(path.join(path.dirname(dll),'wwwroot',asset))),
    `Built ${asset} is stale; rebuild before running browser tests.`);
}
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${socket.address().port}`;
await new Promise(resolve => socket.close(resolve));
const server = spawn('dotnet', [dll, '--urls', base], {cwd:appDir,
  env:{...process.env,NEBIUS_API_KEY:'',DEMO_LIVE_ENABLED:'false'},stdio:'ignore'});
let browser, failed = 0, passed = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, body) {
  const page = await browser.newPage({acceptDownloads:true});
  page.setDefaultTimeout(5000);
  await page.route('**/api/live/status', route => route.fulfill({json:{available:true,reason:'Synthetic admission'}}));
  try { await body(page); console.log(`PASS ${name}`); passed++; }
  catch(error) { console.log(`FAIL ${name}: ${error.message}`); failed++; }
  finally { await page.close(); }
}
try {
  let ready = false;
  for(let i=0;i<100;i++) {
    try { if ((await fetch(base+'/api/cases')).ok) { ready=true; break; } } catch {}
    if(server.exitCode !== null) throw new Error('Local host exited');
    await sleep(100);
  }
  assert(ready, 'Local host did not start');
  const servier = await (await fetch(base+'/api/cases/servier-visual')).json();
  browser = await chromium.launch({executablePath:chrome,headless:true});
  await check('recorded case clears recovered failure', async page => {
    await page.route('**/api/cases/servier-visual', route => route.fulfill({status:503,json:{}}));
    await page.goto(base);
    await page.locator('#case-error').waitFor({state:'visible'});
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#source-type').getByText('PDF / PAGE 04').waitFor();
    assert(await page.locator('#case-error').isHidden(), 'Recovered case still shows old error');
  });
  await check('recorded case ignores delayed failure from prior selection', async page => {
    let delayed;
    await page.route('**/api/cases/servier-visual', route => { delayed=route; });
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#case-select').options.length===2);
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#source-type').getByText('PDF / PAGE 04').waitFor();
    assert(delayed, 'Initial request was not captured');
    await delayed.fulfill({status:503,json:{}});
    await sleep(100);
    assert(await page.locator('#case-error').isHidden(), 'Stale failure overlays the current case');
  });
  await check('recorded case ignores old success after A B A selection', async page => {
    let first, count=0;
    await page.route('**/api/cases/servier-visual', route => {
      if (++count===1) { first=route; return; }
      return route.fulfill({json:{...servier,source:{...servier.source,citation:'LATEST SOURCE'}}});
    });
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#case-select').options.length===2);
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#source-type').getByText('PDF / PAGE 04').waitFor();
    await page.locator('#case-select').selectOption('servier-visual');
    await page.locator('#source-citation').getByText('LATEST SOURCE',{exact:true}).waitFor();
    await first.fulfill({json:{...servier,source:{...servier.source,citation:'STALE SOURCE'}}});
    await sleep(100);
    assert.equal(await page.locator('#source-citation').textContent(),'LATEST SOURCE');
  });
  await check('audit export retains identity with opt-in fingerprints and no plaintext', async page => {
    const source='HLA-B27 was recorded.', draft='HLA-B27을 기록했습니다.';
    const sha = text => createHash('sha256').update(text,'utf8').digest('hex');
    let calls=0;
    await page.route('**/api/live/document-excerpt', async route => {
      calls++;
      const body=route.request().postDataJSON();
      assert.equal(body.sourceText,source);
      return route.fulfill({json:{status:'ok',translation:draft,model:'synthetic',promptTokens:11,completionTokens:7,qcSummary:'Scoped checks only.',review:{
        runId:'identity-001',translationStage:{state:'completed'},critiqueStage:{state:'skipped'},rulesStage:{state:'completed'},
        modelFindings:[],ruleFindings:[],coverage:[{category:'identifier',state:'checked'},{category:'negation',state:'checked'}],elapsedMs:1,
        identity:{targetLanguage:'ko',sourceSha256:sha(source),draftSha256:sha(draft),textNormalization:'trim-utf8',ruleVersion:'test-rule-v1',appVersion:'test-build-v1'}
      }}});
    });
    await page.goto(base);
    const fixture=await browser.newPage();
    await fixture.setContent(`<p style="font:24px Arial">${source}</p>`);
    const pdf=await fixture.pdf({format:'A4'}); await fixture.close();
    await page.locator('#document-file').setInputFiles({name:'identity.pdf',mimeType:'application/pdf',buffer:pdf});
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-text').fill(source);
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText(draft,{exact:true}).waitFor();
    await page.locator('#document-coverage').getByText('negation (marker presence only): checked',{exact:true}).waitFor();
    await page.locator('#document-coverage').getByText(/Another negative phrase can mask an omitted negation/).waitFor();
    async function audit() {
      const downloaded=page.waitForEvent('download');
      await page.locator('#document-audit-export').click();
      return JSON.parse(await readFile(await (await downloaded).path(),'utf8'));
    }
    const basic=await audit();
    assert.equal(basic.identity?.targetLanguage,'ko');
    assert.equal(basic.identity?.ruleVersion,'test-rule-v1');
    assert.equal(basic.identity?.appVersion,'test-build-v1');
    assert.equal(basic.identity?.sourceSha256,undefined, 'Fingerprint exported without opt-in');
    assert.equal(basic.humanInspectionAcknowledged,false);
    await page.locator('#document-export-fingerprints').check();
    await page.locator('#document-human-acknowledge').check();
    const linked=await audit();
    assert.equal(linked.identity.sourceSha256,sha(source));
    assert.equal(linked.identity.draftSha256,sha(draft));
    assert.equal(linked.identity.textNormalization,'trim-utf8');
    assert.equal(linked.humanInspectionAcknowledged,true);
    assert(!JSON.stringify(linked).includes(source) && !JSON.stringify(linked).includes(draft), 'Audit leaked plaintext');
    assert.equal(calls,1,'Export dispatched inference');
    if (process.env.MTQC_REVIEW_SCREENSHOTS) {
      mkdirSync(process.env.MTQC_REVIEW_SCREENSHOTS,{recursive:true});
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:960});
        await page.locator('#document-result').scrollIntoViewIfNeeded();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'Horizontal overflow');
        await page.screenshot({path:path.join(process.env.MTQC_REVIEW_SCREENSHOTS,`audit-${width}.png`),fullPage:false});
      }
    }
    await page.locator('#document-language').selectOption('es');
    assert(await page.locator('#document-result').isHidden(),'Language change retained stale result');
    assert(await page.locator('#document-audit-export').isDisabled(),'Stale export remains enabled');
    assert.equal(await page.locator('#document-export-fingerprints').isChecked(),false,'Fingerprint opt-in leaked into next review');
  });
} finally { await browser?.close(); server.kill(); }
console.log(`${passed}/${passed+failed} passed`);
process.exitCode=failed?1:0;
