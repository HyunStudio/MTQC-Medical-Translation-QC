import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { evaluateQuality, fragmentCoverage } from './corpus-quality.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || '../../qa/corpus-20260930');
const label = process.argv[3] || 'baseline';
const data = JSON.parse(readFileSync(path.join(root, 'cases.json'), 'utf8'));
const expectations = JSON.parse(readFileSync(path.join(here, 'corpus.expectations.json'), 'utf8'));
const allowances = JSON.parse(readFileSync(path.join(here, 'corpus.allowed-failures.json'), 'utf8'));
const appDir = path.resolve(here, '../web_demo');
const build = spawnSync('dotnet', ['build', path.join(appDir, 'MedicalQcWebDemo.csproj'), '--nologo'], {cwd:appDir,stdio:'inherit'});
if (build.status !== 0) throw new Error('Corpus app build failed.');
const chromePath = [process.env.CHROME_PATH, path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe')].find(p => p && existsSync(p));
if (!chromePath) throw new Error('Set CHROME_PATH to Chrome.');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn('dotnet', [path.join(appDir, 'bin/Debug/net10.0/MedicalQcWebDemo.dll'), '--urls', base], {
  cwd: appDir, env: { ...process.env, NEBIUS_API_KEY: '', DEMO_LIVE_ENABLED: 'false' }, stdio: 'ignore'
});
const out = path.join(root, label);
mkdirSync(out, { recursive: true });
const normalize = text => text.normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
const score = (text, expectation) => {
  const value = normalize(text);
  return { anchors: expectation.anchors.map(anchor => ({ anchor, found: value.includes(normalize(anchor)) })),
    order: expectation.order.map(([a, b]) => ({ before: a, after: b, pass: value.indexOf(normalize(a)) >= 0 && value.indexOf(normalize(b)) > value.indexOf(normalize(a)) })),
    imageLabels: (expectation.imageLabels || []).map(anchor => ({ anchor, found: value.includes(normalize(anchor)) })) };
};
let browser;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/cases')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Server did not start.');
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  for (const specimen of data.cases.filter(c => !process.argv[4] || new RegExp(process.argv[4]).test(c.id))) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(90000);
    const external = [], posted = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(base) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url());
      if (request.method() === 'POST') posted.push(request.url());
    });
    const started = Date.now();
    try {
      await page.goto(base + '/#try-document', { waitUntil: 'networkidle' });
      const ocrProfile = specimen.source === 'servier' ? 'diagram' : 'page';
      await page.locator('#document-ocr-profile').selectOption(ocrProfile);
      await page.locator('#document-file').setInputFiles(path.join(root, specimen.file));
      await page.waitForFunction(() => /Text layer extracted locally|Scanned PDF OCR completed locally|Local English OCR (confidence|completed)|could not read|could not be read/.test(document.querySelector('#document-status').textContent), null, { timeout: 90000 });
      const text = await page.locator('#document-text').inputValue();
      const variantId = specimen.id.replace(/-(scan|lowres)$/, '');
      const pairPages = specimen.id.endsWith('-pair')
        ? specimen.pages.map(n => expectations[`${specimen.source}-p${String(n).padStart(2,'0')}`]).filter(Boolean) : [];
      const expectation = expectations[specimen.id] || expectations[variantId]
        || (pairPages.length ? {anchors:pairPages.flatMap(p=>p.anchors),order:pairPages.flatMap(p=>p.order)} : null)
        || (specimen.id==='spine-mixed' ? {anchors:[...expectations['spine-p02'].anchors,...expectations['spine-p03'].anchors],order:[]} : null)
        || (specimen.anchors ? { anchors:specimen.anchors, order:[] } : null);
      const record = { id:specimen.id, kind:specimen.kind, pages:specimen.pages, ocrProfile, elapsedMs:Date.now()-started,
        status:await page.locator('#document-status').textContent(), characters:Array.from(text).length,
        reviewRequired:!(await page.locator('#document-reviewed').isChecked()), translationDisabled:await page.locator('#document-translate').isDisabled(),
        externalRequests:external, postedRequests:posted, errors, ...(expectation ? score(text, expectation) : {}) };
      writeFileSync(path.join(out, specimen.id + '.txt'), text);
      if (specimen.kind === 'text-pdf') {
        record.layout = await page.locator('#document-layout-summary').textContent();
        const bytes = readFileSync(path.join(root, specimen.file)).toString('base64');
        record.geometry = await page.evaluate(async encoded => {
          const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
          const { recoverReadingOrder } = await import('/document-layout.mjs');
          const task = pdfjs.getDocument({data:Uint8Array.from(atob(encoded), c=>c.charCodeAt(0))});
          const pdf = await task.promise;
          const records=[];
          for(let n=1;n<=pdf.numPages;n++) {
            const p=await pdf.getPage(n), v=p.getViewport({scale:1.25}), content=await p.getTextContent();
            const items=content.items.filter(i=>i.str?.trim()).map(i=>{const t=pdfjs.Util.transform(v.transform,i.transform);const h=Math.hypot(t[2],t[3]);return {text:i.str,x:t[4],y:t[5]-h,width:i.width*v.scale,height:h,angle:Math.round(Math.atan2(t[1],t[0])*180/Math.PI)};});
            const op=await p.getOperatorList();
            const recovered= recoverReadingOrder(items,v.width);
            records.push({page:n, width:v.width, height:v.height, fragments:items.length, items,
              retained:recovered.fragmentCount, outputFragmentIds:recovered.lines.flatMap(line=>line.fragmentIds),
              angles:items.reduce((a,i)=>(a[i.angle]=(a[i.angle]||0)+1,a),{}),imageOperations:op.fnArray.filter(o=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].includes(o)).length});
          }
          await task.destroy();return records;
        },bytes);
        if (expectation?.table) {
          await page.locator('#document-order-mode').selectOption('single');
          await page.locator('#document-apply-order').click();
          const rowText=await page.locator('#document-text').inputValue();
          record.rowMode=score(rowText,expectation);
          writeFileSync(path.join(out,specimen.id+'-rows.txt'),rowText);
        }
      }
      if (specimen.id === 'spine-p03' || specimen.id === 'ear-p03' || specimen.id === 'spine-p09' || specimen.id === 'servier-visual') await page.locator('#try-document').screenshot({path:path.join(out,specimen.id+'.png')});
      if ((process.env.MTQC_CORPUS_CAPTURE || '').split(',').includes(specimen.id))
        await page.locator('#try-document').screenshot({path:path.join(out,specimen.id+'-workbench.png')});
      results.push(record);
      console.log(`${specimen.id}: ${record.characters} chars; anchors ${(record.anchors||[]).filter(a=>a.found).length}/${(record.anchors||[]).length}; order ${(record.order||[]).filter(a=>a.pass).length}/${(record.order||[]).length}; ${record.elapsedMs}ms`);
    } catch(error) { results.push({id:specimen.id,error:error.message,errors}); console.log(`FAIL ${specimen.id}: ${error.message}`); }
    await page.close();
    writeFileSync(path.join(out,'results.json'),JSON.stringify({label,createdAt:new Date().toISOString(),results},null,2));
  }
  results.forEach(record => {
    record.qualityIssues = evaluateQuality(record, allowances);
    (record.geometry || []).forEach(g => g.coverage = fragmentCoverage(g.items.map((_, index) => index), g.outputFragmentIds));
  });
  const counts={cases:results.length,errors:results.filter(r=>r.error||r.errors?.length).length,externalRequests:results.reduce((s,r)=>s+(r.externalRequests?.length||0),0),postedRequests:results.reduce((s,r)=>s+(r.postedRequests?.length||0),0),
    reviewGateFailures:results.filter(r=>!r.error&&(!r.reviewRequired||!r.translationDisabled)).length,
    fragmentLossPages:results.flatMap(r=>r.geometry||[]).filter(g=>g.coverage.missing.length||g.coverage.duplicates.length||g.coverage.unexpected.length).length,
    observedContentLimitations:results.filter(r=>(r.anchors||[]).some(a=>!a.found)||(r.order||[]).some(a=>!a.pass)).map(r=>({id:r.id,missingAnchors:(r.anchors||[]).filter(a=>!a.found).length,failedOrderEdges:(r.order||[]).filter(a=>!a.pass).length})),
    unexpectedAnchorOrOrderFailures:results.filter(r=>r.qualityIssues.length).map(r=>({id:r.id,issues:r.qualityIssues}))};
  writeFileSync(path.join(out,'results.json'),JSON.stringify({label,createdAt:new Date().toISOString(),results},null,2));
  console.log(JSON.stringify(counts));
  writeFileSync(path.join(out,'summary.json'),JSON.stringify(counts,null,2));
  if(counts.errors||counts.externalRequests||counts.postedRequests||counts.reviewGateFailures||counts.fragmentLossPages||counts.unexpectedAnchorOrOrderFailures.length) process.exitCode=1;
} finally {await browser?.close();server.kill();}
