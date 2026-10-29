import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { imageMaskControlPdf, vectorCaptionControlPdf } from './authored-pdf-controls.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSelectedPageReviewDraft } from '../web_demo_evaluation/structure-selected-page-intake.mjs';
import { createReviewedArtifactDraft } from '../web_demo_evaluation/structure-artifact-authoring.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../web_demo');
const appDll = path.join(appDir, 'bin/Debug/net10.0/MedicalQcWebDemo.dll');
const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to the Chrome executable.');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPlainExcerptSelection(payload, sourceText, targetLanguage) {
  assert(payload && Object.keys(payload).sort().join(',') ===
    'comparisonSource,displaySourceText,includeExperimentalCritique,sourceText,targetLanguage',
    'Selection contains unexpected source/file fields');
  assert(payload.sourceText === sourceText && payload.displaySourceText === sourceText &&
    payload.targetLanguage === targetLanguage && payload.includeExperimentalCritique === false,
    'Selection altered the reviewed text, language or optional critique choice');
  assert(payload.comparisonSource?.status === 'not-applicable' &&
    payload.comparisonSource?.sourceReviewed === false && payload.comparisonSource?.text === null,
    'Plain prose selection invented structure review or a replacement source');
}

function geometryPdf(width, height) {
  const content = 'BT /F1 4 Tf 2 2 Td (Artery.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Demo server exited before startup.');
    try {
      const response = await fetch(base + '/api/cases');
      if (response.ok) return;
    } catch { /* startup can take a few seconds */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Demo server did not start within 15 seconds.');
}

if (!process.env.MTQC_SKIP_TEST_BUILD) {
  const build = spawnSync('dotnet', ['build', path.join(appDir, 'MedicalQcWebDemo.csproj'), '--nologo'], {
    cwd: appDir,
    stdio: 'inherit'
  });
  if (build.status !== 0) throw new Error('Demo build failed before browser tests.');
}
if (!existsSync(appDll)) throw new Error('Demo DLL is missing; build before browser tests.');
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn('dotnet', [appDll, '--urls', base], {
  cwd: appDir,
  env: { ...process.env, NEBIUS_API_KEY: '', DEMO_LIVE_ENABLED: 'false' },
  stdio: 'ignore'
});
let browser;
let passed = 0;
let failed = 0;

async function newReadyPage(options) {
  const page = await browser.newPage(options);
  // Structure/source-review tests simulate available inference; the local host stays paid-disabled.
  // Individual availability tests override this route with their own transitions/failures.
  await page.route('**/api/live/status', route => route.fulfill({ json: { available: true, reason: 'Synthetic browser-test admission' } }));
  return page;
}
async function check(name, test) {
  if (process.env.MTQC_SMOKE_FILTER && !process.env.MTQC_SMOKE_FILTER.split('|').some(filter => name.includes(filter))) return;
  const priorContexts = new Set(browser.contexts());
  try {
    await test();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error}`);
  } finally {
    for (const context of browser.contexts())
      if (!priorContexts.has(context)) await context.close();
  }
}

async function reviewedSourceRegion(page, expectedText) {
  await page.locator('#structure-review [data-region-id]').first().click();
  if (expectedText !== undefined) {
    await page.locator('#structure-region-text').fill(expectedText);
    await page.locator('#structure-region-save').click();
  }
  await page.locator('#structure-region-verify').click();
  const status = await page.locator('#structure-status').textContent();
  assert(status.includes('Excerpt review-ready'), `Source region is not review-ready: ${status}`);
  await page.locator('#document-reviewed').check();
}

async function uploadReviewablePdf(page, sourceText, name = 'review.pdf') {
  const fixture = await newReadyPage();
  await fixture.setContent(`<p style="font:24px Arial">${sourceText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`);
  const pdf = await fixture.pdf({ format: 'A4' });
  await fixture.close();
  await page.locator('#document-file').setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf });
  await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
  await reviewedSourceRegion(page, sourceText);
}

try {
  await waitForServer(base, server);
  browser = await chromium.launch({ executablePath: chromePath, headless: true });

  await check('live availability refreshes after success without hiding the draft or saved examples', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(5000);
    let held = false, calls = 0;
    await page.route('**/api/live/status', route => route.fulfill({ json: {
      available: !held, reason: held ? 'Billing confirmation pending.' : 'Ready'
    } }));
    await page.route('**/api/live/excerpt', route => {
      calls++; held = true;
      return route.fulfill({ json: { status: 'ok', translation: 'Retained draft', model: 'synthetic', promptTokens: 11, completionTokens: 7, qcSummary: 'Human review required.' } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#live-run').click();
    await page.locator('#live-result').getByText('Retained draft').waitFor();
    await page.waitForFunction(() => document.querySelector('#live-run').disabled && document.querySelector('#live-status').textContent.includes('Billing confirmation pending.'), null, { timeout: 5000 });
    await page.locator('#live-saved-examples').click();
    assert((await page.locator('#source-sections').innerText()).length > 0, 'Paused inference hid the recorded source');
    assert((await page.locator('#live-result').innerText()).includes('Retained draft'), 'Status refresh erased the existing draft');
    assert(calls === 1, 'Status refresh dispatched another model request');
    await page.close();
  });

  await check('live availability fails closed on malformed or failed status and keeps saved examples', async () => {
    for (const status of [{ available: 'true', reason: 'invalid boolean' }, { available: true }, null]) {
      const page = await newReadyPage();
      page.setDefaultTimeout(5000);
      let calls = 0;
      await page.route('**/api/live/status', route => status === null ? route.abort() : route.fulfill({ json: status }));
      await page.route('**/api/live/excerpt', route => { calls++; return route.abort(); });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#case-select').selectOption('mueller-figure1');
      assert(await page.locator('#live-run').isDisabled(), 'Unverified status enabled paid action');
      assert(await page.locator('#live-saved-examples').isVisible(), 'Status failure hid the saved examples link');
      assert(calls === 0, 'Status failure issued a model request');
      await page.close();
    }
  });

  await check('live availability updates both request buttons after a document rejection', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(5000);
    let held = false, calls = 0;
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: !held, reason: held ? 'Cost accounting is paused.' : 'Ready' } }));
    await page.route('**/api/live/document-excerpt', route => {
      calls++; held = true;
      return route.fulfill({ status: 429, json: { status: 'rate-limited', message: 'Cost accounting is paused.' } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'Dose 2 mg.');
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#document-translate').click();
    await page.waitForFunction(() => document.querySelector('#document-translate').disabled && document.querySelector('#live-run').disabled && document.querySelector('#document-availability').textContent.includes('Cost accounting is paused.'), null, { timeout: 5000 });
    assert((await page.locator('#document-text').inputValue()).includes('Dose 2 mg.'), 'Budget hold erased source text');
    assert(await page.locator('#document-saved-examples').isVisible(), 'Document hold hid the saved examples link');
    assert(calls === 1, 'Document rejection retried inference');
    await page.close();
  });

  for (const outcome of ['failure', 'cancel']) await check(`live availability refreshes after ${outcome} without retry`, async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(5000);
    let held = false, calls = 0;
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: !held, reason: held ? 'Unresolved usage remains held.' : 'Ready' } }));
    await page.route('**/api/live/document-excerpt', async route => {
      calls++; held = true;
      if (outcome === 'cancel') return;
      await route.fulfill({ status: 502, json: { status: 'provider-error', message: 'Provider did not complete.' } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'Dose 2 mg.');
    const requestStarted = outcome === 'cancel' ? page.waitForRequest('**/api/live/document-excerpt') : null;
    await page.locator('#document-translate').click();
    if (outcome === 'cancel') {
      await requestStarted;
      await page.locator('#document-cancel').click();
    }
    await page.waitForFunction(() => document.querySelector('#document-translate').disabled && document.querySelector('#document-availability').textContent.includes('Unresolved usage remains held.'), null, { timeout: 5000 });
    assert((await page.locator('#document-text').inputValue()).includes('Dose 2 mg.'), 'Failure/cancel erased reviewed source');
    assert(await page.locator('#document-saved-examples').isVisible(), 'Failure/cancel hid saved examples');
    assert(calls === 1, 'Failure/cancel automatically retried inference');
    await page.close();
  });

  await check('structure observer cannot substitute the live source graph', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const observed = await page.evaluate(async () => {
      const { mountStructureReview } = await import('/document-structure-review.mjs');
      const privateHost = document.createElement('div');
      document.body.append(privateHost);
      const shadow = privateHost.attachShadow({ mode: 'open' });
      const host = document.querySelector('#structure-review').cloneNode(true);
      const preview = document.createElement('div'); shadow.append(host,preview);
      let notifications = 0;
      const controller = mountStructureReview({ host, preview, onChange({ document: observed }) {
        notifications++;
        if (observed.pages[0]) {
          observed.pages[0].regions[0].text = 'Observer substitution';
          observed.pages[0].regions[0].status = 'verified';
          observed.pages[0].visualInventoryConfirmed = true;
        }
      } });
      controller.setPages([{ width: 300, height: 400, fragments: [
        { text: 'Authored original text', x: 20, y: 30, width: 180, height: 12 }
      ], hasImages: false, ocrText: '' }]);
      return { document: controller.getDocument(), notifications };
    });
    assert(observed.notifications === 1, 'Observer control did not receive the actual setPages notification');
    const source = observed.document.pages[0];
    assert(source.regions[0].text === 'Authored original text', 'Observer changed actual source text');
    assert(source.regions[0].status === 'proposed', 'Observer manufactured source verification');
    assert(source.visualInventoryConfirmed === false, 'Observer manufactured whole-page inventory');
    await page.close();
  });

  await check('private controller snapshot preserves source generations and reviewed edits', async () => {
    const page = await newReadyPage();
    await page.goto(base, {waitUntil:'networkidle'});
    const result = await page.evaluate(async () => {
      const {mountStructureReview} = await import('/document-structure-review.mjs');
      const privateHost=document.createElement('div'); document.body.append(privateHost);
      const shadow=privateHost.attachShadow({mode:'open'});
      const host=document.querySelector('#structure-review').cloneNode(true);
      const preview=document.createElement('div'); shadow.append(host,preview);
      const controller=mountStructureReview({host,preview});
      const records=[{width:300,height:200,fragments:[{text:'I',x:40,y:20,width:12,height:3.336}],hasImages:false,ocrText:''}];
      const sourcePages=[{caseId:'authored-physical-5',physicalPage:5,pageId:'p1',sourceSha256:'a'.repeat(64),
        pageImageSha256:'b'.repeat(64),pdfUserUnit:1,
        frame:{viewBox:[10,20,210,320],rotation:90,scale:1,transform:[0,1,1,0,-20,-10],width:300,height:200},
        nativeFragmentIds:['p1-f0'],sourceRenderEquivalence:'unverified',canonicalFragmentCrosswalk:'unavailable'}];
      controller.setPages(records);
      const missing=controller.getReviewSnapshot();
      if(missing.status !== 'ABSTAIN') throw new Error('Missing physical source association emitted a private draft');
      controller.setPages(records,sourcePages);
      sourcePages[0].caseId='caller substitution';
      const original=controller.getReviewSnapshot();
      host.querySelector('[data-region-id]').click();
      host.querySelector('#structure-region-text').value='Authored correction';
      host.querySelector('#structure-region-save').click();
      const edited=controller.getReviewSnapshot();
      edited.document.pages[0].regions[0].text='snapshot substitution';
      edited.sourcePages[0].physicalPage=1;
      const retained=controller.getReviewSnapshot();
      const bad=structuredClone(sourcePages);bad[0].frame.width=301;
      let rejected=false;try{controller.setPages(records,bad);}catch{rejected=true;}
      const afterRejected=controller.getReviewSnapshot();
      controller.clear();const cleared=controller.getReviewSnapshot();
      controller.setPages(records);const replacement=controller.getReviewSnapshot();
      return {original,retained,rejected,afterRejected,cleared,replacement};
    });
    assert(result.original.status==='DRAFT' && result.original.sourceGeneration===2,'Bound source generation missing');
    assert(result.retained.document.pages[0].regions[0].text==='Authored correction','Reviewed edit did not survive isolation');
    assert(result.retained.sourcePages[0].physicalPage===5 && result.retained.sourcePages[0].caseId==='authored-physical-5','Source identity substituted');
    assert(result.rejected && result.afterRejected.sourceGeneration===2,'Rejected source replacement changed generation');
    assert(result.afterRejected.document.pages[0].regions[0].text==='Authored correction','Rejected source replacement changed graph');
    assert(result.cleared.status==='ABSTAIN' && result.replacement.status==='ABSTAIN','Stale source association survived clearing/replacement');
    assert(result.retained.manualReview.editCount===null && result.retained.manualReview.durationSeconds===null,'Controller invented human timing/counts');
    await page.close();
  });

  await check('private structural journal excludes selection and captures UI versus programmatic changes', async () => {
    const page=await newReadyPage();await page.goto(base,{waitUntil:'networkidle'});
    const result=await page.evaluate(async()=>{
      const {mountStructureReview}=await import('/document-structure-review.mjs');
      const parent=document.createElement('div');document.body.append(parent);const shadow=parent.attachShadow({mode:'open'});
      const host=document.querySelector('#structure-review').cloneNode(true),preview=document.createElement('div');shadow.append(host,preview);
      const controller=mountStructureReview({host,preview});
      const records=[{width:500,height:400,fragments:[
        {text:'Alpha',x:20,y:20,width:50,height:12},{text:'Beta',x:20,y:100,width:50,height:12},
        {text:'Gamma',x:20,y:180,width:50,height:12}],hasImages:false,ocrText:''}];
      const metadata=[{caseId:'authored-journal-1',physicalPage:1,pageId:'p1',sourceSha256:'a'.repeat(64),
        pageImageSha256:'b'.repeat(64),pdfUserUnit:1,frame:{viewBox:[0,0,500,400],rotation:0,scale:1,
        transform:[1,0,0,-1,0,400],width:500,height:400},nativeFragmentIds:['p1-f0','p1-f1','p1-f2'],
        sourceRenderEquivalence:'unverified',canonicalFragmentCrosswalk:'unavailable'}];
      controller.setPages(records,metadata);const initial=controller.getReviewSnapshot();
      if(initial.interactionJournal?.recordedStructuralActionCount!==0)throw Error('Bound snapshot lacks explicit observed-action capture');
      host.querySelector('[data-region-id]').click();const selected=controller.getReviewSnapshot();
      host.querySelector('#structure-region-text').value='Authored correction';host.querySelector('#structure-region-save').click();
      const edited=controller.getReviewSnapshot();host.querySelector('#structure-region-save').click();const noOp=controller.getReviewSnapshot();
      host.querySelector('#structure-region-box').value='-1,0,10,10';host.querySelector('#structure-region-save').click();
      const rejectedEdit=controller.getReviewSnapshot();
      controller.applyReadingOrderFromLines('p1',[{fragmentIds:[2,1,0]}]);const programmatic=controller.getReviewSnapshot();
      host.querySelector('#structure-order-checked').click();host.querySelector('#structure-order-verify').click();
      const verified=controller.getReviewSnapshot();
      const bad=structuredClone(metadata);bad[0].physicalPage=0;try{controller.setPages(records,bad);}catch{}
      const rejectedReplacement=controller.getReviewSnapshot();
      verified.interactionJournal.events[0].kind='forged';const isolated=controller.getReviewSnapshot();
      controller.setPages(records,metadata);const replacement=controller.getReviewSnapshot();
      controller.clear();const cleared=controller.getReviewSnapshot();
      return {initial,selected,edited,noOp,rejectedEdit,programmatic,verified,rejectedReplacement,isolated,replacement,cleared};
    });
    assert(result.selected.interactionJournal.recordedStructuralActionCount===0,'Selection counted as structural work');
    assert(result.edited.interactionJournal.events[0].kind==='update-region','Actual UI correction missing');
    assert(result.noOp.interactionJournal.recordedStructuralActionCount===1 && result.rejectedEdit.interactionJournal.recordedStructuralActionCount===1,'No-op or rejected edit counted');
    assert(result.programmatic.interactionJournal.events[1].origin==='programmatic-order-preview','Programmatic order change classified as UI work');
    assert(result.verified.interactionJournal.events[2]?.kind==='verify-reading-order','Reading verification batch missing');
    assert(result.rejectedReplacement.interactionJournal.recordedStructuralActionCount===3,'Invalid source replacement lost history');
    assert(result.isolated.interactionJournal.events[0].kind==='update-region','Returned journal mutated history');
    assert(result.replacement.interactionJournal.recordedStructuralActionCount===0 && result.replacement.sourceGeneration===2,'Source replacement reused prior history');
    assert(result.cleared.status==='ABSTAIN','Retired source returned private draft');
    assert(result.verified.manualReview.editCount===null && result.verified.interactionJournal.actorAuthentication==='unavailable','Controller claimed authenticated human work');
    await page.close();
  });

  await check('private controller actual PDF draft connects to byte-bound artifact authoring', async () => {
    const require=createRequire(new URL('../web_demo_client/package.json',import.meta.url));
    const {createCanvas}=require('@napi-rs/canvas');
    const maskBytes=new Uint8Array(imageMaskControlPdf());
    const pageImageBytes=new Uint8Array(createCanvas(300,300).toBuffer('image/png'));
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    const frame={viewBox:[0,0,300,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:300,height:300};
    const maskIdentity={caseId:'authored-mask-physical-1',physicalPage:1,sourceSha256:hash(maskBytes),pageImageSha256:hash(pageImageBytes)};
    const maskIntake=await createSelectedPageReviewDraft({sourceBytes:maskBytes,selections:[{identity:maskIdentity,canonicalImageBytes:pageImageBytes,frame}]});
    assert(maskIntake.status==='ABSTAIN' && maskIntake.reason==='EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED' && !Object.hasOwn(maskIntake,'pages'),'Original image mask bypassed its existing intake hold');
    // A separate vector/blue-caption control exercises editor mechanics. The
    // original mask remains held, and neither blank PNG certifies source pixels.
    const sourceBytes=new Uint8Array(vectorCaptionControlPdf());
    const identity={caseId:'authored-vector-caption-physical-1',physicalPage:1,sourceSha256:hash(sourceBytes),pageImageSha256:hash(pageImageBytes)};
    const intake=await createSelectedPageReviewDraft({sourceBytes,selections:[{identity,canonicalImageBytes:pageImageBytes,frame}]});
    assert(intake.status==='DRAFT','Actual PDF intake failed');
    const payload={records:intake.pages.map(value=>value.record),sourcePages:intake.pages.map(value=>({
      ...value.identity,pageId:value.pageId,pdfUserUnit:value.pdfUserUnit,frame:value.frame,
      nativeFragmentIds:value.nativeFragments.map(fragment=>fragment.id),
      sourceRenderEquivalence:value.sourceRenderEquivalence,canonicalFragmentCrosswalk:value.canonicalFragmentCrosswalk}))};
    const page=await newReadyPage();await page.goto(base,{waitUntil:'networkidle'});
    const result=await page.evaluate(async payload=>{
      const {mountStructureReview}=await import('/document-structure-review.mjs');
      const parent=document.createElement('div');document.body.append(parent);
      const shadow=parent.attachShadow({mode:'open'});
      const host=document.querySelector('#structure-review').cloneNode(true),preview=document.createElement('div');
      shadow.append(host,preview);const controller=mountStructureReview({host,preview});
      controller.setPages(payload.records,payload.sourcePages);
      const before=controller.getReviewSnapshot();
      host.querySelector('[data-region-id]').click();
      host.querySelector('#structure-region-text').value='Authored caption correction';
      host.querySelector('#structure-region-save').click();
      return {before,after:controller.getReviewSnapshot()};
    },payload);
    assert(result.after.status==='DRAFT','Actual mounted controller rejected valid parsed metadata');
    assert(!intake.pages[0].record.hasImages && intake.pages[0].sourceRenderEquivalence==='unverified','Separate vector control acquired raster or source authority');
    assert(result.after.document.pages[0].regions[0].text==='Authored caption correction','Actual controller edit missing');
    const request={selection:identity,sourceBytes,pageImageBytes,pageId:'p1',document:result.after.document,
      checklist:[{id:'coverage',kind:'fragment-coverage'}],bindings:[{id:'coverage',reviewed:false}]};
    const authored=createReviewedArtifactDraft(request);
    assert(authored.status==='DRAFT' && authored.artifact.document.pages[0].regions[0].text==='Authored caption correction','Byte-bound authoring lost controller graph');
    assert(authored.observations[0].status==='unresolved' && authored.manualEditCount===null,'Integration invented review evidence');
    const changed=new Uint8Array(sourceBytes);changed[0]=0;
    const rejected=createReviewedArtifactDraft({...request,sourceBytes:changed});
    assert(rejected.status==='ABSTAIN' && !Object.hasOwn(rejected,'artifact'),'Changed actual PDF emitted artifact');
    await page.close();
  });

  await check('structure footnote requires an explicit reviewed source association', async () => {
    const page = await newReadyPage();
    await page.setContent('<p style="font:20px Arial">Response is 42 percent.</p><p style="font:20px Arial">* Applies only to subgroup A.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'note-review.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await reviewedSourceRegion(page, 'Response is 42 percent.');
    const rows = page.locator('#structure-region-list [data-region-id]');
    assert(await rows.count() === 2, 'Expected body and footnote source regions');
    const targetId = await rows.first().getAttribute('data-region-id');
    await rows.nth(1).click();
    await page.locator('#structure-region-type').selectOption('footnote');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).startsWith('Region cannot be verified:'), 'Unassessed footnote verification was accepted');
    assert(await page.locator('#document-text').inputValue() === '', 'Unassessed footnote emitted a verified excerpt');
    assert(await page.locator('#structure-footnote-editor').count() === 1, 'Missing footnote association controls');
    await page.locator('#structure-footnote-decision').selectOption('linked');
    await page.locator('#structure-footnote-targets').selectOption(targetId);
    await page.locator('#structure-footnote-checked').check();
    await page.locator('#structure-footnote-apply').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).startsWith('Region cannot be verified:'), 'Proposed note relationship was accepted');
    await page.locator('#structure-footnote-verify').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready.'), 'Verified note target did not enable excerpt');
    await page.locator('#structure-order-checked').check();
    await page.locator('#structure-order-verify').click();
    await page.locator('#structure-inventory').check();
    assert((await page.locator('#structure-status').textContent()).includes('Whole-page complete.'), 'Reviewed note page did not complete');
    await page.locator('#structure-region-text').fill('* Applies only to subgroup B.');
    await page.locator('#structure-region-save').click();
    assert(!await page.locator('#structure-footnote-checked').isChecked(), 'Note correction retained source association approval');
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).startsWith('Region cannot be verified:'), 'Note correction bypassed renewed association review');
    await page.locator('#structure-footnote-decision').selectOption('standalone');
    await page.locator('#structure-footnote-reason').fill('Synthetic correction is treated as an independent note after inspection.');
    await page.locator('#structure-footnote-checked').check();
    await page.locator('#structure-footnote-apply').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready.'), 'Explicit standalone decision did not enable note excerpt');
    await page.close();
  });

  await check('structure visual concern assessment completes a manually reviewed raster page', async () => {
    const imagePage = await newReadyPage({ viewport: { width: 100, height: 80 } });
    await imagePage.setContent('<body style="margin:0;background:white;color:black;font:28px Arial">MRI</body>');
    const image = await imagePage.screenshot();
    await imagePage.close();
    const page = await newReadyPage();
    await page.setContent(`<body style="margin:0"><img style="display:block;width:100px;height:80px" src="data:image/png;base64,${image.toString('base64')}"><p style="font:18px Arial">Artery source text.</p></body>`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'raster-review.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await reviewedSourceRegion(page, 'Artery source text.');
    await page.locator('#structure-add-region').click();
    await page.locator('#structure-new-box').fill('0, 0, 94, 75');
    await page.locator('#structure-new-text').fill('MRI image');
    await page.locator('#structure-new-save').click();
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-figure-decision').selectOption('labels-transcribed');
    await page.locator('#structure-figure-labels').fill('MRI');
    await page.locator('#structure-figure-checked').check();
    await page.locator('#structure-figure-apply').click();
    await page.locator('#structure-move-up').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-order-checked').check();
    await page.locator('#structure-order-verify').click();
    await page.locator('#structure-inventory').check();
    assert((await page.locator('#structure-status').textContent()).includes('Whole-page unresolved'), 'Inventory alone retired raster concern');
    assert((await page.locator('#structure-issues').textContent()).includes('raster-content-unassessed'), 'Expected source raster warning');
    const concern = page.locator('[data-concern="raster-content-unassessed"]');
    assert(await concern.count() === 1, 'Missing explicit visual concern assessment control');
    const ids = await page.locator('#structure-region-list [data-region-id]').evaluateAll(nodes => nodes.map(node => node.dataset.regionId));
    await concern.locator('[data-field="regions"]').selectOption(ids);
    await concern.locator('[data-field="source-checked"]').check();
    await concern.getByRole('button', { name: 'Record visual assessment' }).click();
    assert(!await page.locator('#structure-inventory').isChecked(), 'Assessment inherited old inventory');
    await page.locator('#structure-inventory').check();
    assert((await page.locator('#structure-status').textContent()).includes('Whole-page complete.'), `Reviewed raster page remains blocked: ${await page.locator('#structure-issues').textContent()}`);
    if (process.env.MTQC_STRUCTURE_QA_DIR) {
      await page.setViewportSize({ width: 390, height: 844 });
      mkdirSync(process.env.MTQC_STRUCTURE_QA_DIR, { recursive: true });
      await page.locator('#structure-visual-concerns').screenshot({ path: path.join(process.env.MTQC_STRUCTURE_QA_DIR, 'visual-concerns-mobile.png') });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Visual concern controls overflow mobile page');
    }
    await page.locator('#structure-region-text').fill('MRI image corrected');
    await page.locator('#structure-region-save').click();
    assert(!await page.locator('#structure-inventory').isChecked(), 'Correction retained page inventory');
    assert(!await concern.locator('[data-field="source-checked"]').isChecked(), 'Correction retained visual concern assessment');
    assert((await page.locator('#structure-status').textContent()).includes('Whole-page unresolved'), 'Correction retained whole-page completion');
    await page.close();
  });

  await check('structure review separates page-specific reading approval', async () => {
    const page = await newReadyPage();
    await page.setContent('<div style="break-after:page">FIRST page artery.<br>FIRST page vein.</div><div>SECOND page artery.<br>SECOND page vein.</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two-reading-pages.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await page.locator('#structure-order-checked').check();
    await page.locator('#structure-order-verify').click();
    await page.locator('#structure-page').selectOption('p2');
    assert(!(await page.locator('#structure-order-checked').isChecked()), 'Page 2 inherited page 1 reading approval');
    assert(await page.locator('#structure-order-verify').isDisabled(), 'Page 2 can verify reading without a fresh check');
    await page.locator('#structure-order-checked').check();
    await page.locator('#document-preview [data-structure-page="p1"] [data-region-id]').first().click({ force: true });
    assert(!(await page.locator('#structure-order-checked').isChecked()), 'Source overlay selection retained another page reading approval');
    await page.close();
  });

  await check('structure review merges and splits text without source loss or retained approval', async () => {
    const page = await newReadyPage();
    await page.setContent('<p style="font:24px Arial">The artery supplies tissue.<br>The vein returns blood.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'split-merge.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    const regions = page.locator('#structure-region-list [data-region-id]');
    const count = await regions.count();
    assert(count === 2, `Expected two text lines, got ${count}`);
    await regions.nth(0).click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    await page.locator('#structure-region-list input[type="checkbox"]').nth(1).check();
    await page.locator('#structure-merge-text').click();
    assert(await regions.count() === 1, 'Merge did not consolidate adjacent source lines');
    assert((await page.locator('#structure-region-text').inputValue()) === 'The artery supplies tissue.\nThe vein returns blood.', 'Merge dropped or reordered source text');
    assert(!(await page.locator('#document-reviewed').isChecked()), 'Merge retained live approval');
    assert(await page.locator('#document-translate').isDisabled(), 'Merge automatically verified a new transcription');
    await page.locator('#structure-region-text').evaluate(input => input.setSelectionRange('The artery supplies tissue.'.length, 'The artery supplies tissue.'.length));
    await page.locator('#structure-split-text').click();
    await page.setViewportSize({ width: 390, height: 900 });
    assert(await page.locator('#structure-split-panel').isVisible(), 'Split editor is hidden on a narrow screen');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Split editor causes horizontal page overflow');
    if (process.env.MTQC_STRUCTURE_QA_DIR) {
      mkdirSync(process.env.MTQC_STRUCTURE_QA_DIR, { recursive: true });
      await page.locator('#structure-split-panel').screenshot({ path: path.join(process.env.MTQC_STRUCTURE_QA_DIR, 'split-light-mobile.png') });
      await page.locator('#theme-toggle').click();
      await page.locator('#structure-split-panel').screenshot({ path: path.join(process.env.MTQC_STRUCTURE_QA_DIR, 'split-dark-mobile.png') });
    }
    await page.locator('#structure-split-fragment-count').fill('1');
    await page.locator('#structure-split-apply').click();
    assert(await regions.count() === 2, 'Split did not restore two source regions');
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt unresolved'), 'Split promoted the parts to verified');
    await regions.nth(1).click();
    assert((await page.locator('#structure-region-text').inputValue()).trim() === 'The vein returns blood.', 'Split lost its second transcription');
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-region-list input[type="checkbox"]').nth(0).check();
    assert(await page.locator('#document-translate').isDisabled(), 'An unverified split part bypassed the gate');
    await regions.nth(0).click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-region-list input[type="checkbox"]').nth(1).check();
    await page.locator('#structure-order-checked').check();
    await page.locator('#structure-order-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready'), 'Explicitly reverified split parts cannot be assembled');
    assert((await page.locator('#document-text').inputValue()).includes('The vein returns blood.'), 'Reviewed split excerpt dropped a source line');
    await page.close();
  });

  await check('rejected nonadjacent merge preserves the editor source target', async () => {
    const page = await newReadyPage();
    await page.setContent('<p style="font:24px Arial">First artery line.<br>Middle vein line.<br>Third vessel line.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'nonadjacent.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    const regions = page.locator('#structure-region-list [data-region-id]');
    await regions.nth(0).click();
    const originalFirst = await page.locator('#structure-region-text').inputValue();
    await page.locator('#structure-region-list input[type="checkbox"]').nth(2).check();
    assert((await page.locator('#structure-region-text').inputValue()) === 'Third vessel line.', 'Test must focus the third region before the rejected merge');
    await page.locator('#structure-merge-text').click();
    assert((await page.locator('#structure-status').textContent()).includes('adjacent'), 'Nonadjacent merge was accepted');
    await page.locator('#structure-region-text').fill('Corrected third vessel line.');
    await page.locator('#structure-region-save').click();
    await regions.nth(0).click();
    const afterFirst = await page.locator('#structure-region-text').inputValue();
    assert(afterFirst === originalFirst, `Rejected merge silently redirected correction to the first region: ${JSON.stringify({ originalFirst, afterFirst })}`);
    await regions.nth(2).click();
    assert((await page.locator('#structure-region-text').inputValue()) === 'Corrected third vessel line.', 'Rejected merge lost the editor target');
    await page.close();
  });

  await check('recorded cases update workflow and actual image links', async () => {
    const page = await newReadyPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert((await page.locator('#workflow-prepared').textContent()).includes('18 target slides'), 'Servier workflow is wrong');
    assert((await page.locator('#source-full-link').getAttribute('href')).endsWith('servier-visual-en.png'), 'Servier source link is wrong');
    await page.locator('#language-select').selectOption('ar');
    assert((await page.locator('#target-full-link').getAttribute('href')).endsWith('servier-visual-ar.png'), 'Arabic target link is wrong');
    assert((await page.locator('#target-sections .text-section').first().getAttribute('dir')) === 'rtl', 'Arabic text is not RTL');
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#workflow-prepared').getByText('Figure 1 draft prepared').waitFor();
    assert((await page.locator('#workflow-review').textContent()).includes('Full-paper and medical review pending'), 'Müller review state is wrong');
    assert((await page.locator('#source-full-link').getAttribute('href')).endsWith('source-page04.png'), 'Müller source link is wrong');
    assert((await page.locator('#language-select').inputValue()) === 'ar', 'Shared language choice was lost on case switch');
    assert((await page.locator('#target-full-link').getAttribute('href')).endsWith('sample-ar.png'), 'Müller Arabic target link is wrong');
    assert((await page.locator('#download-link').getAttribute('href')).endsWith('.pdf'), 'Müller artifact is not a PDF');
    await page.close();
  });

  await check('document intake offers all 18 live translation targets', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const values = await page.locator('#document-language option').evaluateAll(options => options.map(option => option.value));
    assert(values.join(',') === 'ko,es,ar,zh-CN,zh-TW,ja,fr,de,it,pt,ru,hi,id,nl,pl,th,tr,vi', 'Document intake lacks the 18 supported targets');
    await page.close();
  });

  await check('document picker remains English and keyboard accessible', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    assert(await page.locator('#document-file-trigger').isVisible(), 'English document picker is missing');
    assert(/Choose.*PDF.*image.*DOCX/i.test(await page.locator('#document-file-trigger').textContent()), 'Document picker does not describe its supported input formats');
    for (const type of ['.pdf', '.png', '.jpg', '.docx'])
      assert((await page.locator('#document-file').getAttribute('accept')).split(',').includes(type), `Document picker omits ${type}`);
    await page.locator('#document-file-trigger').focus();
    assert(await page.locator('#document-file-trigger').evaluate(node => node === document.activeElement), 'Document picker is not keyboard focusable');
    await page.close();
  });

  await check('document intake is discoverable from desktop and mobile navigation', async () => {
    const desktop = await newReadyPage({ viewport: { width: 1440, height: 900 } });
    await desktop.goto(base, { waitUntil: 'networkidle' });
    assert(await desktop.locator('.sidebar nav a[href="#try-document"]').isVisible(), 'Desktop document intake navigation is missing');
    await desktop.close();
    const mobile = await newReadyPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(base, { waitUntil: 'networkidle' });
    assert(await mobile.locator('#mobile-sections a[href="#try-document"]').isVisible(), 'Mobile document intake navigation is missing');
    await mobile.close();
  });

  await check('document intake rejects a file over 10 MiB before processing', async () => {
    const page = await newReadyPage();
    // Transferring a 10 MiB in-memory fixture through Playwright can exceed the UI's normal 2.5s wait on Windows.
    page.setDefaultTimeout(15000);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({
      name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1)
    });
    await page.locator('#document-status').getByText(/10 MiB/).waitFor();
    assert(await page.locator('#document-translate').isDisabled(), 'Oversized file permitted translation');
    await page.close();
  });

  await check('corrupt image decoding stops before OCR with an explicit intake error', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(12000);
    let workerRequests = 0;
    await page.route('**/vendor/tesseract/worker.min.js', route => {
      workerRequests++;
      return route.abort();
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({
      name: 'truncated.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex')
    });
    await page.locator('#document-status').getByText(/Image could not be decoded locally|Local OCR could not read this image/).waitFor();
    const state = await page.evaluate(() => ({
      naturalWidth: document.querySelector('#document-preview img')?.naturalWidth ?? 0,
      status: document.querySelector('#document-status').textContent
    }));
    assert(workerRequests === 0, `Failed image decoding still started OCR: ${JSON.stringify({ ...state, workerRequests })}`);
    assert(state.status.includes('Image could not be decoded locally'), 'Unreadable image lacks an explicit intake error');
    assert(await page.locator('#document-preview').isHidden(), 'Unreadable source preview remains visible');
    assert(await page.locator('#structure-review').isHidden(), 'Unreadable source has a reviewable graph');
    assert(await page.locator('#document-text').isDisabled(), 'Unreadable source enables excerpt input');
    assert(await page.locator('#document-reviewed').isDisabled(), 'Unreadable source enables approval');
    assert(await page.locator('#document-translate').isDisabled(), 'Unreadable source enables translation');
    await page.close();
  });

  await check('late failed image decoding preserves the replacement source and URL', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(12000);
    await page.route('**/vendor/tesseract/worker.min.js', route => route.abort());
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const originalDecode = HTMLImageElement.prototype.decode;
      const originalRevoke = URL.revokeObjectURL.bind(URL);
      window.revokedImageUrls = [];
      URL.revokeObjectURL = url => {
        window.revokedImageUrls.push(url);
        originalRevoke(url);
      };
      let intercepted = false;
      HTMLImageElement.prototype.decode = function () {
        if (intercepted || !this.src.startsWith('blob:')) return originalDecode.call(this);
        intercepted = true;
        window.oldDecodeUrl = this.src;
        return new Promise((resolve, reject) => { window.rejectOldDecode = reject; })
          .finally(() => { window.oldDecodeSettled = true; });
      };
    });
    await page.locator('#document-file').setInputFiles({
      name: 'old-truncated.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex')
    });
    await page.waitForFunction(() => typeof window.rejectOldDecode === 'function');
    await page.locator('#document-file').setInputFiles({
      name: 'replacement.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64')
    });
    await page.locator('#document-status').getByText(/Local OCR could not read this image/).waitFor();
    const replacementUrl = await page.locator('#document-preview img').getAttribute('src');
    assert(await page.locator('#structure-review').isVisible(), 'Replacement source has no manual review page before old decode settles');
    assert(await page.locator('#structure-add-region').isVisible(), 'Replacement source has no manual-region control before old decode settles');
    await page.evaluate(() => { window.rejectOldDecode(new Error('old source decode failed')); });
    await page.waitForFunction(() => window.oldDecodeSettled === true);
    const state = await page.evaluate(() => ({
      url: document.querySelector('#document-preview img')?.src,
      revoked: window.revokedImageUrls,
      oldUrl: window.oldDecodeUrl,
      status: document.querySelector('#document-status').textContent
    }));
    assert(state.url === replacementUrl && !state.revoked.includes(replacementUrl), 'Late old decode cleared or revoked the replacement image');
    assert(state.revoked.includes(state.oldUrl), 'Source replacement did not release the old image URL');
    assert(state.status.includes('Local OCR could not read this image'), 'Late old decode replaced the current source status');
    assert(await page.locator('#structure-review').isVisible(), 'Late old decode cleared the replacement review page');
    assert(await page.locator('#structure-page option[value="p1"]').count() === 1, 'Late old decode removed the replacement page');
    assert(await page.locator('#structure-add-region').isVisible(), 'Late old decode removed manual-region recovery');
    assert(await page.locator('#document-translate').isDisabled(), 'Replacement source bypassed review');
    await page.close();
  });

  await check('local image stays in browser until reviewed text is submitted', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<div id="source" style="background:white;color:black;font:bold 45px Arial;padding:25px">The proximal artery measures 2.5 mm.</div>');
    const image = await page.locator('#source').screenshot();
    const externalRequests = [];
    page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:')) externalRequests.push(request.url()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.selectedExcerpt = null;
      document.addEventListener('document-excerpt-selected', event => { window.selectedExcerpt = event.detail; });
    });
    await page.locator('#document-file').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-preview img').waitFor();
    await page.locator('#document-status').getByText(/Local English OCR|Local OCR could not read/).waitFor({ timeout: 90000 });
    assert(await page.locator('#structure-review [data-region-id]').first().isVisible(), 'OCR proposal cannot be reviewed');
    assert(await page.locator('#document-translate').isDisabled(), 'Translation enabled before explicit review');
    await reviewedSourceRegion(page, 'The proximal artery measures 2.5 mm.');
    await page.locator('#document-language').selectOption('ar');
    assert(!(await page.locator('#document-experimental-critique').isChecked()), 'experimental critique was enabled by default');
    await page.locator('#document-translate').click();
    const payload = await page.evaluate(() => window.selectedExcerpt);
    assertPlainExcerptSelection(payload, 'The proximal artery measures 2.5 mm.', 'ar');
    assert(externalRequests.length === 0, `Browser requested an external asset: ${externalRequests[0]}`);
    await page.close();
  });

  await check('self-hosted English OCR starts without a third-party request', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<div id="ocr-sample" style="width:680px;height:150px;background:white;color:black;font:bold 56px Arial;padding:30px">PROXIMAL ARTERY 2185</div>');
    const image = await page.locator('#ocr-sample').screenshot();
    await page.goto(base, { waitUntil: 'networkidle' });
    const externalRequests = [];
    const browserErrors = [];
    page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:')) externalRequests.push(request.url()); });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.locator('#document-file').setInputFiles({ name: 'ocr.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-status').getByText(/Local English OCR .*Review and correct/).waitFor().catch(async error => {
      throw new Error(`${error.message}; status=${await page.locator('#document-status').textContent()}; errors=${browserErrors.join(' | ')}`);
    });
    await page.locator('#structure-review [data-region-id]').first().click();
    assert((await page.locator('#structure-region-text').inputValue()).length > 5, 'OCR returned no useful reviewable text');
    assert(externalRequests.length === 0, `OCR requested an external asset: ${externalRequests[0]}`);
    await page.close();
  });

  await check('automatic image OCR invalidates approval of an empty source', async () => {
    const page = await newReadyPage({viewport:{width:1000,height:400}});
    await page.setContent('<body style="margin:0;background:white"><p style="font:44px Arial;color:black">The artery measures 12 mm.</p></body>');
    const image = await page.screenshot();
    // Delay transport only; the real local OCR worker still recognizes this image.
    await page.route('**/vendor/tesseract/worker.min.js', async route => {
      await new Promise(resolve => setTimeout(resolve,1500));
      await route.continue();
    });
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#document-file').setInputFiles({name:'synthetic-artery.png',mimeType:'image/png',buffer:image});
    await page.locator('#document-preview img').waitFor();
    assert(await page.locator('#document-text').inputValue() === '', 'OCR delay did not establish an empty initial source');
    await page.locator('#document-reviewed').check();
    await page.waitForFunction(() => /Local English OCR/.test(document.querySelector('#document-status').textContent),null,{timeout:90000});
    await page.locator('#structure-review [data-region-id]').first().click();
    assert((await page.locator('#structure-region-text').inputValue()).includes('12 mm'), 'Actual local OCR did not recognize the controlled source');
    assert(!await page.locator('#document-reviewed').isChecked(), 'OCR replacement inherited approval of an empty source');
    assert(await page.locator('#document-translate').isDisabled(), 'Unreviewed OCR replacement permits translation');
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Verified OCR region did not enable translation');
    await page.close();
  });

  await check('late image OCR cannot replace a newly reviewed PDF', async () => {
    const page = await newReadyPage({ viewport: { width: 1000, height: 400 } });
    await page.setContent('<body style="margin:0;background:white"><p style="font:44px Arial;color:black">Old artery image 12 mm.</p></body>');
    const image = await page.screenshot();
    let releaseWorker;
    let workerRequested;
    const workerGate = new Promise(resolve => { releaseWorker = resolve; });
    const workerSeen = new Promise(resolve => { workerRequested = resolve; });
    await page.route('**/vendor/tesseract/worker.min.js', async route => {
      workerRequested();
      await workerGate;
      await route.continue().catch(() => {});
    });
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#document-file').setInputFiles({ name: 'old-image.png', mimeType: 'image/png', buffer: image });
      await Promise.race([
        workerSeen,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Old OCR worker did not start')), 12000))
      ]);
      await uploadReviewablePdf(page, 'New reviewed artery text.', 'new-source.pdf');
      releaseWorker();
      await page.waitForTimeout(400);
      assert(await page.locator('#document-text').inputValue() === 'New reviewed artery text.', 'Late OCR replaced the reviewed PDF excerpt');
      assert(await page.locator('#document-reviewed').isChecked(), 'Late OCR revoked approval of the new PDF');
      assert(await page.locator('#document-translate').isEnabled(), 'Late OCR disabled the new verified source');
      assert(!(await page.locator('#document-status').textContent()).includes('Local English OCR'), 'Old OCR status replaced the new PDF status');
    } finally {
      releaseWorker();
      await page.close();
    }
  });

  await check('blank OCR gives a usable source-linked manual transcription path', async () => {
    const page = await newReadyPage({ viewport: { width: 360, height: 160 } });
    await page.setContent('<body style="margin:0;background:white"></body>');
    const image = await page.screenshot();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => /Local English OCR|Local OCR could not/.test(document.querySelector('#document-status').textContent), null, { timeout: 90000 });
    assert((await page.locator('#document-status').textContent()).includes('Add missing visual region'), 'Blank OCR directs the reviewer to a readonly text preview');
    assert(await page.locator('#structure-add-region').isVisible(), 'Manual source-linked region control is missing');
    assert(await page.locator('#document-translate').isDisabled(), 'Blank OCR enabled live translation');
    await page.close();
  });

  await check('three-page PDF is rejected without extracting a partial excerpt', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    await page.setContent('<div style="break-after:page">Page one</div><div style="break-after:page">Page two</div><div>Page three</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'three.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/2-page limit/).waitFor();
    assert(await page.locator('#document-translate').isDisabled(), 'Three-page PDF permitted translation');
    await page.close();
  });

  await check('oversized PDF page geometry is rejected before canvas allocation', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(`${error.name}: ${error.message.slice(0, 160)}`));
    await page.setContent('<p>Large drawing sheet</p>');
    const pdf = await page.pdf({width:'70in',height:'70in'});
    await page.goto(base, {waitUntil:'networkidle'});
    await page.locator('#document-file').setInputFiles({name:'oversized-page.pdf',mimeType:'application/pdf',buffer:pdf});
    try { await page.locator('#document-status').getByText(/Page dimensions exceed/).waitFor(); }
    catch (error) {
      const observedStatus = await page.locator('#document-status').textContent({ timeout: 1000 }).catch(() => '[unavailable]');
      console.error(JSON.stringify({ check: 'oversized PDF geometry', observedStatus, browserErrors }));
      throw error;
    }
    assert(await page.locator('#document-translate').isDisabled(), 'Oversized page enabled translation');
    assert(await page.locator('#document-preview').isHidden(), 'Oversized page allocated a visible preview');
    await page.close();
  });

  await check('extreme-aspect PDF geometry is rejected before canvas allocation', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'long-thin.pdf', mimeType: 'application/pdf', buffer: geometryPdf(100000, 10) });
    try { await page.locator('#document-status').getByText(/Page dimensions exceed/).waitFor(); }
    catch (error) {
      console.error(JSON.stringify({ check: 'extreme-aspect PDF geometry', status: await page.locator('#document-status').textContent(),
        canvases: await page.locator('#document-preview canvas').evaluateAll(nodes => nodes.map(canvas => ({
          width: canvas.width, height: canvas.height, emptyBitmap: canvas.toDataURL() === 'data:,' }))) }));
      throw error;
    }
    assert(await page.locator('#document-translate').isDisabled(), 'Extreme-aspect page enabled translation');
    assert(await page.locator('#document-preview').isHidden(), 'Extreme-aspect page allocated a visible source');
    assert(await page.locator('#document-preview canvas').count() === 0, 'Extreme-aspect page allocated a canvas');
    await page.close();
  });

  await check('tall source crop stays within usable bitmap dimensions', async () => {
    const page = await newReadyPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 40000;
      canvas.getContext('2d').fillRect(0, 0, 1, 40000);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.route('**/vendor/tesseract/worker.min.js', route => route.abort());
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'tall-line.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator('#document-status').getByText(/Local OCR could not read/).waitFor();
    await page.locator('#structure-add-region').click();
    await page.locator('#structure-new-box').fill('0, 0, 1, 40000');
    await page.locator('#structure-new-text').fill('Vertical decorative line');
    await page.locator('#structure-new-save').click();
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    const crop = await page.locator('#structure-source-crop').evaluate(canvas => ({
      width: canvas.width, height: canvas.height, emptyBitmap: canvas.toDataURL() === 'data:,'
    }));
    assert(crop.width <= 800 && crop.height <= 800 && !crop.emptyBitmap, `Unusable source crop: ${JSON.stringify(crop)}`);
    await page.close();
  });

  await check('two-page text PDF renders locally and yields editable source regions', async () => {
    const page = await newReadyPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.setContent('<div style="break-after:page">The proximal artery is 2.5 mm.</div><div>Page two reference.</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-preview canvas').first().waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    assert((await page.locator('#structure-region-text').inputValue()).includes('proximal artery'), 'PDF text was not linked to an editable region');
    assert(await page.locator('#document-text').getAttribute('readonly') !== null, 'Excerpt preview became editable outside the graph');
    assert(pageErrors.length === 0, `PDF lifecycle raised a browser error: ${pageErrors.join('; ')}`);
    await page.close();
  });

  await check('source-linked structure review preserves proposals, evidence, and explicit approval', async () => {
    const page = await newReadyPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15000);
    await page.setContent('<div style="break-after:page"><h2>Artery study</h2><p>The artery measures 2.5 mm.</p></div><div>Page two reference.</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'structure.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().waitFor();
    assert((await page.locator('#structure-status').textContent()).includes('Proposed'), 'Structure proposal was reported as verified');
    assert(await page.locator('.structure-source-box').count() > 0, 'No source boxes link regions to the rendered page');
    const first = page.locator('#structure-review [data-region-id]').first();
    const firstId = await first.getAttribute('data-region-id');
    await first.click();
    assert(await page.locator(`.structure-source-box[data-region-id="${firstId}"]`).evaluate(node => node.classList.contains('selected')), 'Selected region did not highlight its source box');
    await page.locator(`.structure-source-box[data-region-id="${firstId}"]`).focus();
    assert(await page.locator(`.structure-source-box[data-region-id="${firstId}"]`).evaluate(node => node === document.activeElement), 'Source box cannot receive keyboard focus');
    const orderBefore = await page.locator('#structure-reading-order').textContent();
    await page.locator('#document-order-mode').selectOption('single');
    assert(await page.locator('#structure-reading-order').textContent() === orderBefore, 'Reading-order preview silently changed the graph');
    await page.locator('#structure-move-down').click();
    assert(await page.locator('#structure-reading-order').textContent() !== orderBefore, 'Explicit region reorder did not change proposed graph order');
    assert((await page.locator('#structure-reading-order').textContent()).includes('proposed'), 'Reordered relationship was falsely verified');
    await page.locator('#structure-region-text').fill('Corrected artery measurement 2.5 mm.');
    await page.locator('#structure-region-save').click();
    assert(!await page.locator('#document-reviewed').isChecked(), 'Graph edit retained source approval');
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt'), 'Verified excerpt status is absent');
    await page.locator('#structure-add-region').click();
    await page.locator('#structure-new-text').fill('Visual label missed by text extraction');
    await page.locator('#structure-new-box').fill('10, 10, 100, 40');
    await page.locator('#structure-new-save').click();
    assert(await page.locator('#structure-review [data-region-id]').count() >= 3, 'Manually transcribed visual region was not added');
    await page.locator('#structure-exclude-reason').fill('Decorative source mark outside selected excerpt');
    await page.locator('#structure-region-exclude').click();
    assert((await page.locator('#structure-status').textContent()).includes('unresolved'), 'Page-level unresolved status disappeared');
    await page.locator('#structure-inventory').check();
    assert((await page.locator('#structure-status').textContent()).includes('unresolved'), 'Inventory confirmation falsely completed an unverified page');
    if (process.env.MTQC_STRUCTURE_SCREENSHOT_DIR) {
      await page.locator('#structure-review').screenshot({ path: path.join(process.env.MTQC_STRUCTURE_SCREENSHOT_DIR, 'structure-review-light.png') });
      await page.locator('#theme-toggle').click();
      await page.locator('#structure-review').screenshot({ path: path.join(process.env.MTQC_STRUCTURE_SCREENSHOT_DIR, 'structure-review-dark.png') });
    }
    await page.close();
  });

  await check('specialized structure controls require source comparison before equation verification', async () => {
    const page = await newReadyPage({ viewport: { width: 1100, height: 850 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<p>D 95% is a displayed measure.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'formula.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('equation');
    await page.locator('#structure-region-save').click();
    assert(await page.locator('#structure-equation-editor').isVisible(), 'Equation source-crop editor is missing');
    assert(await page.locator('#structure-source-crop').isVisible(), 'Equation source crop is not visible');
    await page.locator('#structure-region-verify').click();
    const blockedStatus = await page.locator('#structure-status').textContent();
    assert(blockedStatus.includes('cannot be verified') && !blockedStatus.includes('review-ready'), `Unreviewed equation was not blocked: ${blockedStatus}`);
    await page.locator('#structure-equation-text').fill('D₉₅%');
    await page.locator('#structure-equation-checked').check();
    await page.locator('#structure-equation-apply').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready'), 'Reviewed equation cannot become an excerpt');
    await page.close();
  });

  await check('table save enforces bounded dimensions without changing a reviewed excerpt', async () => {
    const page = await newReadyPage();
    await page.setContent('<p>Table 1 Dose</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'bounded-table.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('table');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-table-rows').fill('1');
    await page.locator('#structure-table-columns').fill('1');
    await page.locator('#structure-table-build').click();
    await page.locator('.structure-table-cell [data-field="text"]').fill('2 mg');
    await page.locator('#structure-table-checked').check();
    await page.locator('#structure-table-apply').click();
    await page.locator('#structure-region-verify').click();
    const before = await page.locator('#document-text').inputValue();
    assert(before.includes('2 mg'), 'Initial reviewed table was not established');
    await page.locator('#structure-table-rows').fill('129');
    await page.locator('#structure-table-apply').click();
    assert((await page.locator('#structure-status').textContent()).includes('1–128'), 'Save bypassed table dimension limit');
    assert(await page.locator('#document-text').inputValue() === before, 'Invalid table edit changed the reviewed graph');
    await page.close();
  });

  for (const kind of ['caption', 'footnote']) await check(`cross-page ${kind} links need renewed review after target corrections`, async () => {
    const page = await newReadyPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<p>Source diagram.</p><p style="break-before:page">Figure 1. Source relationship.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: `two-page-${kind}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    const targetId = await page.locator('#structure-review [data-region-id]').first().getAttribute('data-region-id');
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-figure-decision').selectOption('no-internal-text');
    await page.locator('#structure-figure-checked').check();
    await page.locator('#structure-figure-apply').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption(kind);
    await page.locator('#structure-region-save').click();
    const targetSelector = kind === 'caption' ? '#structure-caption-target' : '#structure-footnote-targets';
    assert(await page.locator(`${targetSelector} option[value="${targetId}"]`).count() === 1,
      'Recorded target on the other selected page is absent from relationship choices');
    assert((await page.locator(`${targetSelector} option[value="${targetId}"]`).textContent()).includes('p1'),
      'Cross-page target choice omits its original source page');
    await page.locator(targetSelector).selectOption(targetId);
    if (kind === 'caption') {
      await page.locator('#structure-caption-link').click();
      await page.locator('#structure-caption-verify').click();
    } else {
      await page.locator('#structure-footnote-decision').selectOption('linked');
      await page.locator('#structure-footnote-checked').check();
      await page.locator('#structure-footnote-apply').click();
      await page.locator('#structure-footnote-verify').click();
    }
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#document-text').inputValue()).includes('Source relationship'),
      'Source-reviewed cross-page relationship did not produce a verified excerpt');
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Reviewed cross-page relationship remained blocked');
    await page.locator('#structure-page').selectOption('p1');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-text').fill('Corrected source diagram.');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    assert(!await page.locator('#document-reviewed').isChecked(), 'Target correction preserved translation approval');
    assert(await page.locator('#document-translate').isDisabled(), 'Target verification alone revived old relationship proof');
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Region cannot be verified'),
      'Target verification alone revived old dependent region proof');
    if (kind === 'footnote') assert(!await page.locator('#structure-footnote-checked').isChecked(),
      'Target correction preserved the old note source assessment');
    await page.close();
  });

  await check('footnote target caption must complete its own source relationship', async () => {
    const page = await newReadyPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<p>Source diagram.</p><p>Figure 1. Diagram caption.</p><p style="break-before:page">* Caption-specific source note.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'note-caption-target.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    const figureId = await page.locator('#structure-review [data-region-id]').first().getAttribute('data-region-id');
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-figure-decision').selectOption('no-internal-text');
    await page.locator('#structure-figure-checked').check();
    await page.locator('#structure-figure-apply').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    const captionId = await page.locator('#structure-review [data-region-id]').nth(1).getAttribute('data-region-id');
    await page.locator('#structure-region-type').selectOption('caption');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-caption-target').selectOption(figureId);
    await page.locator('#structure-caption-link').click();
    await page.locator('#structure-caption-verify').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('footnote');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-footnote-decision').selectOption('linked');
    await page.locator('#structure-footnote-targets').selectOption(captionId);
    await page.locator('#structure-footnote-checked').check();
    await page.locator('#structure-footnote-apply').click();
    await page.locator('#structure-footnote-verify').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Valid caption-to-note dependency is blocked');
    await page.locator('#structure-page').selectOption('p1');
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('#structure-caption-link').click();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-footnote-checked').check();
    await page.locator('#structure-footnote-apply').click();
    assert(await page.locator('#structure-footnote-verify').isDisabled(),
      'An unresolved target caption allowed footnote relationship verification');
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Region cannot be verified'),
      'An unresolved target caption allowed footnote region verification');
    assert(await page.locator('#document-translate').isDisabled(), 'Unresolved caption dependency allows live translation');
    await page.locator('#structure-page').selectOption('p1');
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('#structure-caption-verify').click();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-footnote-checked').check();
    await page.locator('#structure-footnote-apply').click();
    await page.locator('#structure-footnote-verify').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Source-reviewed caption dependency could not be renewed');
    await page.close();
  });

  await check('reviewed table caption links and cell corrections preserve source approval gates', async () => {
    const page = await newReadyPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<p>Table 1. Measurements.</p><p>Measure 2 mm</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'table-caption.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    const tableId = await page.locator('#structure-review [data-region-id]').nth(1).getAttribute('data-region-id');
    await page.locator('#structure-region-type').selectOption('table');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-table-rows').fill('2');
    await page.locator('#structure-table-columns').fill('1');
    await page.locator('#structure-table-build').click();
    await page.locator('.structure-table-cell').nth(0).locator('[data-field="text"]').fill('Measure');
    await page.locator('.structure-table-cell').nth(0).locator('[data-field="role"]').selectOption('header');
    await page.locator('.structure-table-cell').nth(1).locator('[data-field="text"]').fill('2 mm');
    await page.locator('.structure-table-cell').nth(1).locator('[data-field="headerCellIds"]').fill('c1-1');
    await page.locator('#structure-table-checked').check();
    await page.locator('#structure-table-apply').click();
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('caption');
    await page.locator('#structure-region-save').click();
    assert(await page.locator(`#structure-caption-target option[value="${tableId}"]`).count() === 1, 'Recorded table is absent from caption target choices');
    await page.locator('#structure-caption-target').selectOption(tableId);
    await page.locator('#structure-caption-link').click();
    await page.locator('#structure-caption-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Verify the target'), 'Unverified table allowed caption association');
    assert(await page.locator('#document-translate').isDisabled(), 'Caption to a proposed table permits live translation');
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-caption-verify').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#document-text').inputValue()).includes('Table 1. Measurements.'), 'Reviewed table caption did not produce a verified excerpt');
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Reviewed table caption remained blocked');
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('.structure-table-cell').nth(1).locator('[data-field="text"]').fill('3 mm');
    await page.locator('#structure-table-checked').check();
    await page.locator('#structure-table-apply').click();
    await page.locator('#structure-review [data-region-id]').first().click();
    assert(!await page.locator('#document-reviewed').isChecked(), 'Table correction retained live approval');
    assert(await page.locator('#document-translate').isDisabled(), 'Table correction retained a ready caption excerpt');
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Region cannot be verified'), 'Table correction retained caption proof');
    await page.close();
  });

  await check('table grid correction and figure-caption decisions remain reviewer-owned', async () => {
    const page = await newReadyPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<p>Table 1 Measure 2 mm</p><p>Figure 1 arterial diagram</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'table-figure.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('table');
    await page.locator('#structure-region-save').click();
    assert(await page.locator('#structure-table-editor').isVisible(), 'Table cell editor is missing');
    await page.locator('#structure-table-rows').fill('2');
    await page.locator('#structure-table-columns').fill('2');
    await page.locator('#structure-table-build').click();
    await page.locator('.structure-table-cell').first().locator('[data-field="text"]').fill('Measure');
    await page.locator('.structure-table-cell').first().locator('[data-field="role"]').selectOption('header');
    await page.locator('.structure-table-cell').nth(1).locator('[data-field="text"]').fill('Value');
    await page.locator('.structure-table-cell').nth(1).locator('[data-field="role"]').selectOption('header');
    await page.locator('.structure-table-cell').nth(2).locator('[data-field="text"]').fill('Artery');
    await page.locator('.structure-table-cell').nth(2).locator('[data-field="headerCellIds"]').fill('c1-1');
    await page.locator('.structure-table-cell').nth(3).locator('[data-field="text"]').fill('2 mm');
    await page.locator('.structure-table-cell').nth(3).locator('[data-field="headerCellIds"]').fill('c1-2');
    await page.locator('#structure-table-checked').check();
    await page.locator('#structure-table-apply').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready'), 'Checked table grid did not become review-ready');
    const reviewedTable = await page.locator('#document-text').inputValue();
    assert(reviewedTable.includes('r1c1') && reviewedTable.includes('1x1') && reviewedTable.includes('→c1-2'), 'Reviewed table excerpt lost explicit cell geometry or header binding');
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-figure-decision').selectOption('no-internal-text');
    await page.locator('#structure-figure-checked').check();
    await page.locator('#structure-figure-apply').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready'), 'Explicit figure decision did not become review-ready');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('caption');
    await page.locator('#structure-region-save').click();
    assert(await page.locator('#structure-caption-editor').isVisible(), 'Caption link editor is missing');
    await page.locator('#structure-caption-target').selectOption(
      await page.locator('#structure-review [data-region-id]').nth(1).getAttribute('data-region-id'));
    await page.locator('#structure-caption-link').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('cannot be verified'), 'Proposed caption link passed without review');
    await page.locator('#structure-caption-verify').click();
    await page.locator('#structure-region-verify').click();
    assert((await page.locator('#structure-status').textContent()).includes('Excerpt review-ready'), 'Verified caption link remained blocked');
    await page.close();
  });

  await check('verified figure labels are retained in the outgoing source excerpt', async () => {
    const page = await newReadyPage();
    await page.setContent('<p>Figure 1 vessel map</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'labelled-figure.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('figure');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-figure-decision').selectOption('labels-transcribed');
    await page.locator('#structure-figure-labels').fill('Aorta\nFemoral artery');
    await page.locator('#structure-figure-checked').check();
    await page.locator('#structure-figure-apply').click();
    await page.locator('#structure-region-verify').click();
    const preview = await page.locator('#document-text').inputValue();
    assert(preview.includes('Aorta') && preview.includes('Femoral artery'), 'Reviewed figure labels disappeared from the source excerpt');
    await page.locator('#document-reviewed').check();
    const pending = page.waitForRequest('**/api/live/document-excerpt');
    await page.locator('#document-translate').click();
    const submitted = (await pending).postDataJSON();
    assert(submitted.sourceText.includes('Aorta') && submitted.sourceText.includes('Femoral artery'), 'Outbound source omitted reviewed figure labels');
    await page.close();
  });

  await check('live document request uses only a verified source-linked region and invalidates on edit', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(12000);
    await page.setContent('<p>The proximal artery measures 2.5 mm.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.selectedExcerpt = null;
      document.addEventListener('document-excerpt-selected', event => { window.selectedExcerpt = event.detail; });
    });
    await page.locator('#document-file').setInputFiles({ name: 'linked.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().waitFor();
    assert(await page.locator('#document-translate').isDisabled(), 'Unverified PDF structure permits live translation');
    assert(await page.locator('#document-text').getAttribute('readonly') !== null, 'Derived excerpt can be edited outside provenance graph');
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-verify').click();
    const verified = await page.locator('#structure-region-text').inputValue();
    assert(await page.locator('#document-text').inputValue() === verified, 'Verified graph did not derive the outbound excerpt preview');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-translate').click();
    const payload = await page.evaluate(() => window.selectedExcerpt);
    assertPlainExcerptSelection(payload, verified, 'ko');
    await page.locator('#structure-region-text').fill('The distal artery measures 3.5 mm.');
    await page.locator('#structure-region-save').click();
    assert(!await page.locator('#document-reviewed').isChecked(), 'Graph correction retained approval');
    assert(await page.locator('#document-translate').isDisabled(), 'Graph correction retained live eligibility');
    await page.close();
  });

  await check('multi-region excerpt is ordered and cannot bypass unverified reading relations', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(12000);
    await page.setContent('<p>Left artery 2.5 mm.</p><p>Right vein 3.5 mm.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two-regions.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#structure-review [data-region-id]').nth(1).click();
    await page.locator('#structure-region-verify').click();
    await page.locator('[aria-label="Include p1-r0 in verified excerpt"]').check();
    assert(await page.locator('#document-translate').isDisabled(), 'Unverified reading relation permits a two-region excerpt');
    await page.locator('#structure-order-checked').check();
    await page.locator('#structure-order-verify').click();
    const previewText = await page.locator('#document-text').inputValue();
    assert(previewText.indexOf('Left artery') < previewText.indexOf('Right vein'), 'Verified excerpt lost source reading order');
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Verified ordered excerpt remained blocked');
    await page.close();
  });

  await check('verified graph excerpt above 3000 code points remains blocked', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'Artery source.');
    await page.locator('#structure-region-text').fill('A'.repeat(3001));
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    assert((await page.locator('#document-text-count').textContent()).includes('shorter excerpt'), 'Overlength warning is absent');
    assert(await page.locator('#document-translate').isDisabled(), 'Overlength verified excerpt permits a provider call');
    await page.close();
  });

  await check('solid-color PDF image mask needs explicit visual inventory beside native text', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'authored-image-mask.pdf', mimeType: 'application/pdf', buffer: Buffer.from(imageMaskControlPdf()) });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    assert((await page.locator('#document-status').textContent()).includes('Figure labels inside images are not included'), 'Solid-color image mask lost its raster warning');
    assert((await page.locator('#structure-review').textContent()).includes('Images and internal text'), 'Image mask has no explicit visual concern assessment');
    assert((await page.locator('#structure-status').textContent()).includes('Whole-page unresolved'), 'Image mask silently certified the whole page');
    assert(await page.locator('#document-translate').isDisabled(), 'Unreviewed image mask permitted translation');
    await page.close();
  });

  await check('PDF text layer with a raster diagram warns that labels are not extracted', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(10000);
    await page.setContent('<div id="diagram" style="background:white;color:black;font:48px Arial">FEMORAL ARTERY 2185</div>');
    const image = await page.locator('#diagram').screenshot();
    await page.setContent(`<h1>Searchable medical paragraph</h1><img width="550" src="data:image/png;base64,${image.toString('base64')}">`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'diagram.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    const text = await page.locator('#structure-region-text').inputValue();
    assert(text.includes('Searchable medical paragraph'), 'Searchable body text was dropped');
    assert(!text.includes('2185'), 'Raster diagram unexpectedly entered the text layer');
    assert((await page.locator('#document-status').textContent()).includes('Figure labels inside images are not included'), 'Missing raster text was silently presented as complete extraction');
    assert(await page.locator('#document-visual-ocr').isEnabled(), 'Optional visual OCR is unavailable for the raster figure');
    await page.locator('#document-visual-ocr').click();
    await page.waitForFunction(() => /FEMORAL ARTERY\s+2185/i.test(document.querySelector('#document-visual-ocr-result')?.value || ''), null, { timeout: 60000 });
    assert(!(await page.locator('#structure-region-text').inputValue()).includes('2185'), 'Unverified visual OCR silently overwrote the text layer');
    assert(await page.locator('#document-translate').isDisabled(), 'Diagram input bypassed review');
    await page.close();
  });

  await check('unreadable PDF glyphs must be corrected before translation', async () => {
    const page = await newReadyPage();
    await page.setContent('<p>Equation from a medical article.</p>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'equation.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    await page.locator('#structure-region-type').selectOption('equation');
    await page.locator('#structure-region-text').fill('Equation: α\u0085ψ');
    await page.locator('#structure-region-save').click();
    await page.locator('#structure-equation-text').fill('Equation: α\u0085ψ');
    await page.locator('#structure-equation-checked').check();
    await page.locator('#structure-equation-apply').click();
    await page.locator('#structure-region-verify').click();
    assert(await page.locator('#document-translate').isDisabled(), 'Unreadable equation glyph was accepted for model translation');
    assert((await page.locator('#structure-status').textContent()).includes('Unreadable control glyph'), 'Reviewer received no actionable glyph warning');
    await page.locator('#structure-equation-text').fill('Equation: α = σ(ψ).');
    await page.locator('#structure-equation-checked').check();
    await page.locator('#structure-equation-apply').click();
    await page.locator('#structure-region-verify').click();
    await page.locator('#document-reviewed').check();
    assert(await page.locator('#document-translate').isEnabled(), 'Corrected equation remained blocked');
    await page.close();
  });

  await check('corrupt PDF with a valid signature fails safely without browser errors', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'corrupt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot a document') });
    await page.locator('#document-status').getByText(/could not be read locally/).waitFor();
    assert(await page.locator('#document-translate').isDisabled(), 'Invalid PDF permitted translation');
    assert(errors.length === 0, `Invalid PDF raised a browser error: ${errors.join('; ')}`);
    await page.close();
  });

  await check('two-column PDF order is visible and reviewer edits survive order preview', async () => {
    const page = await newReadyPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<style>body{font:18px Arial;margin:35px;color:#183746}h1{font-size:26px}main{display:grid;grid-template-columns:1fr 1fr;gap:55px}p{margin:0 0 20px}</style><h1>Vascular anatomy — QA specimen</h1><main><section><p>Left first artery.</p><p>Left second vein.</p><p>Left third capillary.</p></section><section><p>Right first reference.</p><p>Right second reference.</p><p>Right third reference.</p></section></main>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two-column.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('.document-order-box').first().waitFor();
    const extracted = (await page.locator('.document-order-box').evaluateAll(boxes => boxes.map(box => box.title))).join('\n');
    assert(extracted.indexOf('Left third') < extracted.indexOf('Right first'), 'Two columns were interleaved');
    assert((await page.locator('#document-layout-summary').textContent()).includes('2 column(s)'), 'Column detection was not shown');
    assert(await page.locator('.document-order-box').count() >= 7, 'Source reading-order overlay missing');
    await reviewedSourceRegion(page, 'Reviewer corrected excerpt.');
    await page.locator('#document-order-mode').selectOption('single');
    assert(await page.locator('#document-text').inputValue() === 'Reviewer corrected excerpt.', 'Previewing order overwrote a reviewer edit');
    assert(await page.locator('#document-reviewed').isChecked(), 'Previewing order revoked source approval');
    assert((await page.locator('#document-layout-summary').textContent()).includes('Preview only'), 'Unapplied order proposal is not identified');
    await page.locator('#document-apply-order').click();
    assert(!(await page.locator('#document-reviewed').isChecked()), 'Replacing text retained old approval');
    assert((await page.locator('#document-layout-summary').textContent()).includes('Applied to structure proposal'), 'Applied order proposal is not identified');
    const rowwise = (await page.locator('.document-order-box').evaluateAll(boxes => boxes.map(box => box.title))).join('\n');
    assert(rowwise.indexOf('Right first') < rowwise.indexOf('Left second'), 'Explicit row ordering did not apply');
    await page.locator('#document-order-mode').selectOption('auto');
    await page.locator('#document-apply-order').click();
    const qaDir = path.resolve(here, '../../output/layout-qa');
    mkdirSync(qaDir, { recursive: true });
    await page.locator('#try-document').screenshot({ path: path.join(qaDir, 'reading-order-light.png') });
    await page.locator('#theme-toggle').click();
    await page.locator('#try-document').screenshot({ path: path.join(qaDir, 'reading-order-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 392), 'Reading-order controls overflow the mobile viewport');
    await page.locator('#try-document').screenshot({ path: path.join(qaDir, 'reading-order-mobile.png') });
    await page.close();
  });

  await check('numeric table preview warns that row alignment is not verified', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(12000);
    await page.setContent('<style>body{font:15px Arial;margin:35px}table{width:100%;border-collapse:collapse}td,th{padding:5px;text-align:left}main{display:grid;grid-template-columns:1fr 1fr;gap:30px}</style><h2>TABLE 1</h2><table><tr><th>Methods</th><th>DSC</th><th>IoU</th><th>Recall</th><th>Time</th></tr><tr><td>Alpha</td><td>0.84</td><td>0.76</td><td>0.83</td><td>0.65</td></tr><tr><td>Beta</td><td>0.85</td><td>0.77</td><td>0.84</td><td>0.27</td></tr></table><h2>2 Evaluation</h2><main><section><p>Left first prose.</p><p>Left second prose.</p></section><section><p>Right first prose.</p><p>Right second prose.</p></section></main>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('.document-order-box').first().waitFor();
    const extracted = (await page.locator('.document-order-box').evaluateAll(boxes => boxes.map(box => box.title))).join('\n');
    assert(extracted.split('\n').some(line => /Alpha\s+0\.84\s+0\.76\s+0\.83\s+0\.65/.test(line)), `Table row association was lost: ${extracted}`);
    assert((await page.locator('#document-layout-summary').textContent()).includes('Numeric table region detected'), 'Table preview did not warn about unverified column semantics');
    assert(await page.locator('#document-translate').isDisabled(), 'Table extraction skipped source review');
    await page.close();
  });

  await check('OCR layout choice is explicit and does not discard reviewer text', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-ocr-profile').selectOption('diagram');
    await page.locator('#document-text').evaluate(element => { element.disabled = false; element.value = 'Reviewer corrected anatomy'; });
    await page.locator('#document-ocr-profile').selectOption('page');
    assert(await page.locator('#document-text').inputValue() === 'Reviewer corrected anatomy', 'OCR preference silently replaced reviewer text');
    await page.close();
  });

  await check('scanned two-column prose does not interleave the left and right columns', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<div id="scan" style="display:flex;gap:80px;padding:30px;background:white;color:black;font:24px Arial;width:840px"><div style="width:380px">LEFT FIRST artery supplies tissue.<br>LEFT SECOND vein returns blood.<br>LEFT THIRD capillary exchanges gas.<br>LEFT FOURTH oxygen moves locally.</div><div style="width:380px">RIGHT FIRST heart pumps blood.<br>RIGHT SECOND kidney filters fluid.<br>RIGHT THIRD vessels carry nutrients.<br>RIGHT FOURTH tissues need oxygen.</div></div>');
    const image = await page.locator('#scan').screenshot();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'columns.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-status').getByText(/Local English OCR .*Review and correct/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    const text = await page.locator('#structure-region-text').inputValue();
    assert(text.includes('LEFT FOURTH') && text.includes('RIGHT FIRST'), 'OCR omitted the test column anchors');
    assert(text.indexOf('LEFT FOURTH') < text.indexOf('RIGHT FIRST'), 'Scanned body columns were interleaved');
    await page.close();
  });

  await check('mixed text and scanned PDF retains text from both pages', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setContent('<div id="scan" style="width:680px;height:150px;background:white;color:black;font:bold 56px Arial;padding:30px">PROXIMAL ARTERY 2185</div>');
    const image = await page.locator('#scan').screenshot();
    await page.setContent(`<div style="break-after:page">TEXT PAGE FEMORAL VEIN</div><img style="width:680px" src="data:image/png;base64,${image.toString('base64')}">`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'mixed.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Scanned PDF OCR completed locally/).waitFor().catch(async error => {
      throw new Error(`${error.message}; status=${await page.locator('#document-status').textContent()}; pageErrors=${pageErrors.join(' | ')}`);
    });
    await page.locator('#structure-review [data-region-id]').first().click();
    const textPage = await page.locator('#structure-region-text').inputValue();
    await page.locator('#structure-page').selectOption('p2');
    await page.locator('#structure-review [data-region-id]').first().click();
    const scanPage = await page.locator('#structure-region-text').inputValue();
    assert(textPage.includes('FEMORAL VEIN') && scanPage.includes('2185'), 'One page of a mixed PDF was silently dropped');
    assert(await page.locator('#document-translate').isDisabled(), 'Mixed PDF skipped review');
    await page.close();
  });

  await check('empty OCR page is explicitly reported while searchable text survives', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<div style="break-after:page">The artery measures 12 mm.</div><div style="width:100px;height:100px;background:black"></div>');
    const pdf = await page.pdf({format:'A4'});
    await page.goto(base, {waitUntil:'networkidle'});
    await page.locator('#document-file').setInputFiles({name:'empty-ocr.pdf',mimeType:'application/pdf',buffer:pdf});
    await page.locator('#document-status').getByText(/Scanned PDF OCR completed locally/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    assert((await page.locator('#structure-region-text').inputValue()).includes('The artery measures 12 mm.'), 'Empty scan discarded searchable text');
    assert((await page.locator('#document-status').textContent()).includes('No text recovered from page(s): 2'), 'Empty OCR page silently disappeared');
    assert(await page.locator('#document-translate').isDisabled(), 'Empty OCR bypassed review');
    await page.close();
  });

  await check('scanned PDF is marked as local OCR requiring review', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<div id="scan" style="width:680px;height:150px;background:white;color:black;font:bold 56px Arial;padding:30px">PROXIMAL ARTERY 2185</div>');
    const image = await page.locator('#scan').screenshot();
    await page.setContent(`<img style="width:680px" src="data:image/png;base64,${image.toString('base64')}">`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Scanned PDF OCR completed locally/).waitFor();
    await page.locator('#structure-review [data-region-id]').first().click();
    assert((await page.locator('#structure-region-text').inputValue()).length > 5, 'Scanned PDF OCR produced no reviewable text');
    assert(await page.locator('#document-translate').isDisabled(), 'OCR bypassed explicit review');
    await page.close();
  });

  await check('reviewed document excerpt uses live model and honest estimated progress', async () => {
    const page = await newReadyPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    let requestBody;
    await page.route('**/api/live/document-excerpt', async route => {
      requestBody = route.request().postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ json: {
        status: 'ok', message: 'AI draft excerpt only', translation: 'الشريان القريب 2.5 مم',
        model: 'nvidia/Nemotron-3_5-Lightning', promptTokens: 20, completionTokens: 8,
        qcSummary: 'Independent medical and linguistic review is still required.',
        review: { runId: 'mock-review', elapsedMs: 1200,
          translationStage: { state: 'completed', model: 'nvidia/Nemotron-3_5-Lightning', promptTokens: 20, completionTokens: 8 },
          critiqueStage: { state: 'skipped' },
          rulesStage: { state: 'completed' }, modelFindings: [], ruleFindings: [], coverage: [] }
      } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'The proximal artery measures 2.5 mm.');
    await page.locator('#document-language').selectOption('ar');
    await page.locator('#document-translate').click();
    await page.locator('#document-progress').waitFor({ state: 'visible' });
    assert(Number(await page.locator('#document-progress-track').getAttribute('aria-valuenow')) < 100, 'Pending call reached 100 percent');
    await page.locator('#document-progress-track[aria-valuenow="100"]').waitFor();
    await page.locator('#document-result').getByText('الشريان القريب 2.5 مم').waitFor();
    assert(JSON.stringify(requestBody) === JSON.stringify({ sourceText: 'The proximal artery measures 2.5 mm.', targetLanguage: 'ar', includeExperimentalCritique: false }), 'Request posted file data, an altered excerpt, or a paid critique by default');
    assert((await page.locator('#document-result').textContent()).includes('Independent medical and linguistic review'), 'QC warning is hidden');
    assert((await page.locator('#document-result').textContent()).includes('nvidia/Nemotron-3_5-Lightning'), 'Actual model identifier is hidden');
    assert((await page.locator('#document-result-translation').getAttribute('dir')) === 'rtl', 'Arabic document draft lost RTL direction');
    assert((await page.locator('#document-model-findings').textContent()).includes('not requested'), 'default result obscures skipped experimental critique');
    await page.close();
  });

  await check('two-stage review separates model and rules with honest coverage', async () => {
    const page = await newReadyPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const source = 'The proximal artery measures 2.5 mm. A 20 mg dose was not recorded.';
    const draft = '동맥은 원위부에서 3.5 mm입니다. 20 mg 용량은 기록되었습니다.';
    let critiqueRequested = false;
    await page.route('**/api/live/document-excerpt', route => {
      critiqueRequested = route.request().postDataJSON().includeExperimentalCritique;
      return route.fulfill({ json: {
      status: 'ok', message: 'Human review required.', translation: draft, model: 'translation-model',
      promptTokens: 20, completionTokens: 8, qcSummary: 'Numeric mismatch.',
      review: { runId: 'review-001', elapsedMs: 1300,
        translationStage: { state: 'completed', model: 'translation-model', promptTokens: 20, completionTokens: 8, elapsedMs: 700 },
        critiqueStage: { state: 'completed', model: 'critique-model', promptTokens: 31, completionTokens: 11, elapsedMs: 550 },
        rulesStage: { state: 'completed', elapsedMs: 1 },
        modelFindings: [{ category: 'number', severity: 'critical', sourceSpan: '2.5 mm', draftSpan: '3.5 mm', rationale: 'Value differs.' }],
        ruleFindings: [
          { category: 'direction', severity: 'review', message: 'Direction differs.', sourceSpan: 'proximal', draftSpan: null },
          { category: 'unit', severity: 'review', message: 'Number-unit pair differs.', sourceSpan: '2.5 mm', draftSpan: '3.5 mm' },
          { category: 'negation-scope', severity: 'review', message: 'Review anchored sentence negation.', sourceSpan: 'A 20 mg dose was not recorded.', draftSpan: '20 mg 용량은 기록되었습니다.' },
          { category: 'other', severity: 'review', message: 'Literal evidence rendering test.', sourceSpan: '<img src=x onerror="window.__ruleXss=1">', draftSpan: null }
        ],
        coverage: [{ category: 'number', state: 'warning' }, { category: 'negation', state: 'not assessed' }, { category: 'negation-scope', state: 'warning' }]
      }
    } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, source);
    await page.locator('#document-experimental-critique').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText(draft).waitFor();
    assert(critiqueRequested === true, 'optional research critique was not explicitly requested');
    assert((await page.locator('#document-review-stages').textContent()).includes('critique-model'), 'second model stage or token usage is hidden');
    assert((await page.locator('#document-model-findings').textContent()).includes('Value differs.'), 'model finding is hidden');
    assert((await page.locator('#document-model-findings').textContent()).includes('2.5 mm → 3.5 mm'), 'exact source and draft evidence spans are hidden');
    assert((await page.locator('#document-model-findings').textContent()).includes('UNVERIFIED MODEL SUGGESTION'), 'model allegation was presented as validated QC');
    assert(!(await page.locator('#document-model-findings').textContent()).includes('critical:'), 'provider severity was presented as a confirmed critical error');
    assert((await page.locator('#document-rule-findings').textContent()).includes('Direction differs.'), 'rule finding is hidden');
    const ruleText = await page.locator('#document-rule-findings').textContent();
    assert(ruleText.includes('Source span: 2.5 mm') && ruleText.includes('Draft span: 3.5 mm'), 'exact rule evidence spans are hidden');
    assert(ruleText.includes('Source span: proximal') && ruleText.includes('Draft span: unavailable'), 'one-sided rule evidence is hidden or falsely completed');
    assert(ruleText.includes('negation-scope') && ruleText.includes('Source span: A 20 mg dose was not recorded.') && ruleText.includes('Draft span: 20 mg 용량은 기록되었습니다.'), 'bounded negation scope evidence is hidden');
    assert((await page.locator('#document-coverage').textContent()).includes('negation-scope: warning'), 'scope warning coverage is hidden');
    assert(ruleText.includes('<img src=x onerror="window.__ruleXss=1">') && await page.locator('#document-rule-findings img').count() === 0,
      'untrusted rule span was interpreted as HTML');
    assert((await page.locator('#document-coverage').textContent()).includes('not assessed'), 'unsupported category was shown as passed');
    assert((await page.locator('#document-human-acknowledge').getAttribute('aria-label')).includes('inspected'), 'human acknowledgment is mislabeled');
    if (process.env.CAPTURE_REVIEW_QA === '1') {
      const captures = path.resolve(here, '../../output/review-qa');
      mkdirSync(captures, { recursive: true });
      await page.locator('#document-result').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(captures, 'review-light-desktop.png'), fullPage: true });
      await page.locator('#theme-toggle').click();
      await page.screenshot({ path: path.join(captures, 'review-dark-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(captures, 'review-dark-mobile.png'), fullPage: true });
    }
    await page.locator('#document-human-acknowledge').check();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#document-audit-export').click();
    const download = await downloadPromise;
    const audit = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
    assert(audit.includes('review-001') && audit.includes('not assessed'), 'audit metadata missing');
    assert(!audit.includes(source) && !audit.includes(draft) && !audit.includes('2.5 mm') && !audit.includes('Value differs.'), 'audit leaked source, draft, or evidence');
    await page.locator('#document-language').selectOption('ar');
    assert(await page.locator('#document-result').isHidden(), 'language change kept stale review');
    assert(!(await page.locator('#document-human-acknowledge').isChecked()), 'language change kept acknowledgment');
    await page.locator('#document-language').selectOption('ko');
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText(draft).waitFor();
    await page.locator('#document-human-acknowledge').check();
    await page.locator('#structure-region-text').fill('The artery now measures 4.5 mm.');
    await page.locator('#structure-region-save').click();
    assert(await page.locator('#document-result').isHidden() && !(await page.locator('#document-human-acknowledge').isChecked()), 'source edit kept stale acknowledgment');
    await page.close();
  });

  await check('critique failure shows incomplete draft without 100 percent completion', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/document-excerpt', route => route.fulfill({ json: {
      status: 'partial', message: 'AI draft — review incomplete.', translation: '검토 전 초안', model: 'translation-model',
      review: { runId: 'review-002', elapsedMs: 400,
        translationStage: { state: 'completed', model: 'translation-model' },
        critiqueStage: { state: 'failed' }, rulesStage: { state: 'completed' },
        modelFindings: [], ruleFindings: [], coverage: [{ category: 'negation', state: 'not assessed' }]
      }
    } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'The artery measures 2.5 mm.');
    await page.locator('#document-experimental-critique').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText('검토 전 초안').waitFor();
    assert((await page.locator('#document-live-status').textContent()).includes('incomplete'), 'partial state was presented as complete');
    assert(Number(await page.locator('#document-progress-track').getAttribute('aria-valuenow')) < 100, 'partial state reached 100 percent');
    await page.close();
  });

  await check('pending document translation locks duplicate submissions and supports cancellation', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    let requests = 0;
    await page.route('**/api/live/document-excerpt', async route => {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 900));
      await route.fulfill({json:{status:'ok',translation:'검수 초안',model:'test-model',qcSummary:'review'}}).catch(() => {});
    });
    await page.setContent('<p>The artery measures 12 mm.</p>');
    const pdf = await page.pdf({format:'A4'});
    await page.goto(base, {waitUntil:'networkidle'});
    await page.locator('#document-file').setInputFiles({name:'review.pdf',mimeType:'application/pdf',buffer:pdf});
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await reviewedSourceRegion(page);
    await page.locator('#document-translate').click();
    assert(await page.locator('#document-translate').isDisabled(), 'Pending request permits another submission');
    await page.locator('#document-translate').dispatchEvent('click');
    await page.waitForTimeout(100);
    assert(requests === 1, 'Duplicate click sent another request');
    await page.locator('#document-cancel').click();
    assert(await page.locator('#document-progress').isHidden(), 'Cancelled request keeps progress active');
    await page.waitForFunction(() => !document.querySelector('#document-translate').disabled);
    assert(await page.locator('#document-translate').isEnabled(), 'Cancel does not release request lock');
    await page.waitForTimeout(1000);
    assert(await page.locator('#document-result').isHidden(), 'Cancelled request displayed its late result');
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText('검수 초안').waitFor();
    await page.waitForFunction(() => !document.querySelector('#document-translate').disabled);
    assert(await page.locator('#document-translate').isEnabled(), 'Successful request does not release lock');
    await page.close();
  });

  await check('revoking source review invalidates pending and completed drafts', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/document-excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({json:{status:'ok',translation:'검수 초안',model:'test-model',qcSummary:'review'}}).catch(() => {});
    });
    await page.setContent('<p>The artery measures 12 mm.</p>');
    const pdf = await page.pdf({format:'A4'});
    await page.goto(base, {waitUntil:'networkidle'});
    await page.locator('#document-file').setInputFiles({name:'review.pdf',mimeType:'application/pdf',buffer:pdf});
    await page.locator('#document-status').getByText(/Text layer extracted locally/).waitFor();
    await reviewedSourceRegion(page);
    await page.locator('#document-translate').click();
    await page.locator('#document-reviewed').uncheck();
    assert(await page.locator('#document-progress').isHidden(), 'Revoked review leaves request active');
    await page.waitForTimeout(800);
    assert(await page.locator('#document-result').isHidden(), 'Revoked review accepted a late draft');
    assert(await page.locator('#document-translate').isDisabled(), 'Revoked review permits translation');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-result-translation').getByText('검수 초안').waitFor();
    await page.locator('#document-reviewed').uncheck();
    assert(await page.locator('#document-result').isHidden(), 'Revoked review retains a completed draft');
    assert(await page.locator('#document-text').inputValue() === 'The artery measures 12 mm.', 'Revoked review lost source text');
    await page.close();
  });

  await check('failed document request preserves source and never shows completion', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/live/document-excerpt', route => route.fulfill({ status: 429, json: {
      status: 'rate-limited', message: 'Live demo request limit reached.'
    } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'The artery measures 2.5 mm.');
    await page.locator('#document-translate').click();
    await page.locator('#document-result-error').getByText('Live demo request limit reached.').waitFor();
    assert(await page.locator('#document-progress').isHidden(), 'Failed request kept a completed progress bar');
    assert(await page.locator('#document-result-grid').isHidden(), 'Failed request displayed a stale translation');
    assert((await page.locator('#document-text').inputValue()) === 'The artery measures 2.5 mm.', 'Source text was lost on failure');
    assert(await page.locator('#document-preview canvas').isVisible(), 'Source page was lost on failure');
    await page.waitForFunction(() => !document.querySelector('#document-translate').disabled);
    assert(await page.locator('#document-translate').isEnabled(), 'Failed request does not release lock');
    await page.close();
  });

  await check('replacing a document invalidates its pending live draft', async () => {
    const page = await newReadyPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/live/document-excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ json: { status: 'ok', message: 'late', translation: '늦은 결과', model: 'test-model', qcSummary: 'review' } }).catch(() => {});
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await uploadReviewablePdf(page, 'The artery measures 2.5 mm.');
    await page.locator('#document-translate').click();
    await page.locator('#document-progress').waitFor({ state: 'visible' });
    await page.locator('#document-file').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64') });
    await page.waitForTimeout(1000);
    assert(await page.locator('#document-result').isHidden(), 'Old draft appeared for a replacement source');
    assert(await page.locator('#document-progress').isHidden(), 'Old progress survived source replacement');
    await page.close();
  });

  await check('all 18 target previews decode and lead to editable artifacts', async () => {
    const page = await newReadyPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const languages = await page.locator('#language-select option').evaluateAll(options => options.map(option => option.value));
    assert(languages.length === 18, `Expected 18 targets, found ${languages.length}`);
    for (const language of languages) {
      await page.locator('#language-select').selectOption(language);
      const preview = await page.locator('#target-preview').evaluate(async image => {
        if (!image.complete) await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', reject, { once: true });
        });
        return { path: new URL(image.src).pathname, width: image.naturalWidth };
      });
      assert(preview.width > 0, `${language} preview did not decode`);
      assert((await page.locator('#target-full-link').getAttribute('href')) === preview.path, `${language} image link differs from preview`);
      assert((await page.locator('#download-link').getAttribute('href')).endsWith('.pptx'), `${language} editable deck link is missing`);
      assert((await page.locator('#target-sections .text-section').count()) > 0, `${language} translated text is missing`);
    }
    await page.close();
  });

  await check('mobile layout and theme stay usable', async () => {
    const page = await newReadyPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert(await page.locator('#mobile-sections').isVisible(), 'Mobile navigation is hidden');
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Mobile page overflows horizontally');
    await page.locator('#mobile-sections a[href="#workbench"]').focus();
    assert(await page.locator('#mobile-sections a[href="#workbench"]').evaluate(node => node === document.activeElement), 'Mobile navigation cannot be focused');
    const before = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme-toggle').click();
    assert((await page.locator('html').getAttribute('data-theme')) !== before, 'Theme toggle did not change theme');
    await page.close();
  });

  await check('desktop keeps its primary navigation visible', async () => {
    const page = await newReadyPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert(!(await page.locator('#mobile-sections').isVisible()), 'Mobile navigation appears on desktop');
    assert(await page.locator('.sidebar nav').isVisible(), 'Desktop navigation is hidden');
    await page.close();
  });

  await check('live progress is explicitly estimated until a successful response reaches 100 percent', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: true, reason: 'Browser test' } }));
    await page.route('**/api/live/excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 1300));
      await route.fulfill({ json: {
        status: 'ok', message: 'Recorded browser test response', translation: '검증용 번역',
        model: 'test-model', promptTokens: 10, completionTokens: 5, qcSummary: 'Human review required.'
      } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.waitForFunction(() => document.querySelector('#live-status')?.textContent.includes('Ready for a bounded model call'));
    await page.locator('#live-run').click();
    await page.locator('#live-progress').waitFor({ state: 'visible' });
    await page.waitForTimeout(1050);
    assert((await page.locator('#live-elapsed').textContent()).includes('Elapsed 1s'), 'Elapsed time did not advance');
    assert((await page.locator('#live-elapsed').textContent()).includes('Estimated'), 'Estimated progress is not labeled');
    const pendingPercent = Number(await page.locator('#live-progress-track').getAttribute('aria-valuenow'));
    assert(pendingPercent >= 1 && pendingPercent < 95, 'Pending request must show a bounded estimated percentage');
    await page.locator('#live-progress-track[aria-valuenow="100"]').waitFor();
    assert((await page.locator('#live-progress').textContent()).includes('Request completed'), '100 percent is not tied to a successful response');
    assert((await page.locator('#live-result').textContent()).includes('검증용 번역'), 'Live result was not rendered');
    await page.close();
  });

  await check('failed live requests never display 100 percent', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: true, reason: 'Browser test' } }));
    await page.route('**/api/live/excerpt', route => route.fulfill({ json: {
      status: 'error', message: 'Provider unavailable', translation: '', model: '',
      promptTokens: 0, completionTokens: 0, qcSummary: ''
    } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#live-run').click();
    await page.locator('#live-result').getByText('Provider unavailable').waitFor();
    assert(await page.locator('#live-progress').isHidden(), 'Failed request left completed progress visible');
    assert(!(await page.locator('#live-result').textContent()).includes('Request completed'), 'Failed request was labeled complete');
    await page.close();
  });

  await check('changing case invalidates a pending live result', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: true, reason: 'Browser test' } }));
    await page.route('**/api/live/excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.fulfill({ json: {
        status: 'ok', message: 'Late browser test response', translation: '늦은 결과',
        model: 'test-model', promptTokens: 10, completionTokens: 5, qcSummary: 'Human review required.'
      } }).catch(() => {});
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#live-run').click();
    await page.locator('#live-progress').waitFor({ state: 'visible' });
    await page.locator('#case-select').selectOption('servier-visual');
    await page.locator('#live-progress').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1150);
    assert(await page.locator('#live-result').isHidden(), 'Stale live result appeared after case change');
    await page.close();
  });

  await check('changing language invalidates a pending live result', async () => {
    const page = await newReadyPage();
    await page.route('**/api/live/status', route => route.fulfill({ json: { available: true, reason: 'Browser test' } }));
    await page.route('**/api/live/excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.fulfill({ json: {
        status: 'ok', message: 'Late browser test response', translation: '늦은 결과',
        model: 'test-model', promptTokens: 10, completionTokens: 5, qcSummary: 'Human review required.'
      } }).catch(() => {});
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#case-select').selectOption('mueller-figure1');
    await page.locator('#live-run').click();
    await page.locator('#live-progress').waitFor({ state: 'visible' });
    await page.locator('#language-select').selectOption('es');
    await page.locator('#live-progress').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1150);
    assert(await page.locator('#live-result').isHidden(), 'Stale live result appeared after language change');
    await page.close();
  });
  console.log(`${passed}/${passed + failed} browser checks passed; ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
