import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

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

const build = spawnSync('dotnet', ['build', path.join(appDir, 'MedicalQcWebDemo.csproj'), '--nologo'], {
  cwd: appDir,
  stdio: 'inherit'
});
if (build.status !== 0 || !existsSync(appDll)) throw new Error('Demo build failed before browser tests.');
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn('dotnet', [appDll, '--urls', base], {
  cwd: appDir,
  env: { ...process.env, NEBIUS_API_KEY: '', DEMO_LIVE_ENABLED: 'false' },
  stdio: 'ignore'
});
let browser;
let passed = 0;

async function check(name, test) {
  await test();
  console.log(`PASS ${name}`);
  passed++;
}

try {
  await waitForServer(base, server);
  browser = await chromium.launch({ executablePath: chromePath, headless: true });

  await check('recorded cases update workflow and actual image links', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const values = await page.locator('#document-language option').evaluateAll(options => options.map(option => option.value));
    assert(values.join(',') === 'ko,es,ar,zh-CN,zh-TW,ja,fr,de,it,pt,ru,hi,id,nl,pl,th,tr,vi', 'Document intake lacks the 18 supported targets');
    await page.close();
  });

  await check('document picker remains English and keyboard accessible', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    assert(await page.locator('#document-file-trigger').isVisible(), 'English document picker is missing');
    assert((await page.locator('#document-file-trigger').textContent()).includes('Choose PDF or image'), 'Document picker copy is not English');
    await page.locator('#document-file-trigger').focus();
    assert(await page.locator('#document-file-trigger').evaluate(node => node === document.activeElement), 'Document picker is not keyboard focusable');
    await page.close();
  });

  await check('document intake is discoverable from desktop and mobile navigation', async () => {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktop.goto(base, { waitUntil: 'networkidle' });
    assert(await desktop.locator('.sidebar nav a[href="#try-document"]').isVisible(), 'Desktop document intake navigation is missing');
    await desktop.close();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(base, { waitUntil: 'networkidle' });
    assert(await mobile.locator('#mobile-sections a[href="#try-document"]').isVisible(), 'Mobile document intake navigation is missing');
    await mobile.close();
  });

  await check('document intake rejects a file over 10 MiB before processing', async () => {
    const page = await browser.newPage();
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

  await check('local image stays in browser until reviewed text is submitted', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const externalRequests = [];
    page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:')) externalRequests.push(request.url()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.selectedExcerpt = null;
      document.addEventListener('document-excerpt-selected', event => { window.selectedExcerpt = event.detail; });
    });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64');
    await page.locator('#document-file').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-preview img').waitFor();
    assert(await page.locator('#document-text').isEnabled(), 'Extracted text cannot be corrected');
    assert(await page.locator('#document-translate').isDisabled(), 'Translation enabled before explicit review');
    await page.locator('#document-text').fill('The proximal artery measures 2.5 mm.');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-language').selectOption('ar');
    await page.locator('#document-translate').click();
    const payload = await page.evaluate(() => window.selectedExcerpt);
    assert(JSON.stringify(payload) === JSON.stringify({ sourceText: 'The proximal artery measures 2.5 mm.', targetLanguage: 'ar' }), 'Outbound selection includes more than reviewed text and language');
    assert(externalRequests.length === 0, `Browser requested an external asset: ${externalRequests[0]}`);
    await page.close();
  });

  await check('self-hosted English OCR starts without a third-party request', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
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
    assert((await page.locator('#document-text').inputValue()).length > 5, 'OCR returned no useful text');
    assert(externalRequests.length === 0, `OCR requested an external asset: ${externalRequests[0]}`);
    await page.close();
  });

  await check('three-page PDF is rejected without extracting a partial excerpt', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.setContent('<div style="break-after:page">Page one</div><div style="break-after:page">Page two</div><div>Page three</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'three.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/2-page limit/).waitFor();
    assert(await page.locator('#document-translate').isDisabled(), 'Three-page PDF permitted translation');
    await page.close();
  });

  await check('two-page text PDF renders locally and yields editable English text', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.setContent('<div style="break-after:page">The proximal artery is 2.5 mm.</div><div>Page two reference.</div>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-preview canvas').first().waitFor();
    await page.waitForFunction(() => document.querySelector('#document-text')?.value.includes('proximal artery'));
    assert(await page.locator('#document-text').isEnabled(), 'Extracted PDF text is not editable');
    await page.close();
  });

  await check('two-column PDF order is visible and reviewer edits survive order preview', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(12000);
    await page.setContent('<style>body{font:18px Arial;margin:35px;color:#183746}h1{font-size:26px}main{display:grid;grid-template-columns:1fr 1fr;gap:55px}p{margin:0 0 20px}</style><h1>Vascular anatomy — QA specimen</h1><main><section><p>Left first artery.</p><p>Left second vein.</p><p>Left third capillary.</p></section><section><p>Right first reference.</p><p>Right second reference.</p><p>Right third reference.</p></section></main>');
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'two-column.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => document.querySelector('#document-text')?.value.includes('Right third'));
    const extracted = await page.locator('#document-text').inputValue();
    assert(extracted.indexOf('Left third') < extracted.indexOf('Right first'), 'Two columns were interleaved');
    assert((await page.locator('#document-layout-summary').textContent()).includes('2 column(s)'), 'Column detection was not shown');
    assert(await page.locator('.document-order-box').count() >= 7, 'Source reading-order overlay missing');
    await page.locator('#document-text').fill('Reviewer corrected excerpt.');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-order-mode').selectOption('single');
    assert(await page.locator('#document-text').inputValue() === 'Reviewer corrected excerpt.', 'Previewing order overwrote a reviewer edit');
    await page.locator('#document-apply-order').click();
    assert(!(await page.locator('#document-reviewed').isChecked()), 'Replacing text retained old approval');
    const rowwise = await page.locator('#document-text').inputValue();
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

  await check('mixed text and scanned PDF retains text from both pages', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setContent('<div id="scan" style="width:680px;height:150px;background:white;color:black;font:bold 56px Arial;padding:30px">PROXIMAL ARTERY 2185</div>');
    const image = await page.locator('#scan').screenshot();
    await page.setContent(`<div style="break-after:page">TEXT PAGE FEMORAL VEIN</div><img style="width:680px" src="data:image/png;base64,${image.toString('base64')}">`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'mixed.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Scanned PDF OCR completed locally/).waitFor();
    const text = await page.locator('#document-text').inputValue();
    assert(text.includes('FEMORAL VEIN') && text.includes('2185'), 'One page of a mixed PDF was silently dropped');
    assert(await page.locator('#document-translate').isDisabled(), 'Mixed PDF skipped review');
    await page.close();
  });

  await check('scanned PDF is marked as local OCR requiring review', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setContent('<div id="scan" style="width:680px;height:150px;background:white;color:black;font:bold 56px Arial;padding:30px">PROXIMAL ARTERY 2185</div>');
    const image = await page.locator('#scan').screenshot();
    await page.setContent(`<img style="width:680px" src="data:image/png;base64,${image.toString('base64')}">`);
    const pdf = await page.pdf({ format: 'A4' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#document-file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-status').getByText(/Scanned PDF OCR completed locally/).waitFor();
    assert((await page.locator('#document-text').inputValue()).length > 5, 'Scanned PDF OCR produced no editable text');
    assert(await page.locator('#document-translate').isDisabled(), 'OCR bypassed explicit review');
    await page.close();
  });

  await check('reviewed document excerpt uses live model and honest estimated progress', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    let requestBody;
    await page.route('**/api/live/document-excerpt', async route => {
      requestBody = route.request().postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ json: {
        status: 'ok', message: 'AI draft excerpt only', translation: 'الشريان القريب 2.5 مم',
        model: 'nvidia/Nemotron-3_5-Lightning', promptTokens: 20, completionTokens: 8,
        qcSummary: 'Independent medical and linguistic review is still required.'
      } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64');
    await page.locator('#document-file').setInputFiles({ name: 'private-source.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-text').fill('The proximal artery measures 2.5 mm.');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-language').selectOption('ar');
    await page.locator('#document-translate').click();
    await page.locator('#document-progress').waitFor({ state: 'visible' });
    assert(Number(await page.locator('#document-progress-track').getAttribute('aria-valuenow')) < 100, 'Pending call reached 100 percent');
    await page.locator('#document-progress-track[aria-valuenow="100"]').waitFor();
    await page.locator('#document-result').getByText('الشريان القريب 2.5 مم').waitFor();
    assert(JSON.stringify(requestBody) === JSON.stringify({ sourceText: 'The proximal artery measures 2.5 mm.', targetLanguage: 'ar' }), 'Request posted file data or an altered excerpt');
    assert((await page.locator('#document-result').textContent()).includes('Independent medical and linguistic review'), 'QC warning is hidden');
    assert((await page.locator('#document-result').textContent()).includes('nvidia/Nemotron-3_5-Lightning'), 'Actual model identifier is hidden');
    assert((await page.locator('#document-result-translation').getAttribute('dir')) === 'rtl', 'Arabic document draft lost RTL direction');
    await page.close();
  });

  await check('failed document request preserves source and never shows completion', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/live/document-excerpt', route => route.fulfill({ status: 429, json: {
      status: 'rate-limited', message: 'Live demo request limit reached.'
    } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64');
    await page.locator('#document-file').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-text').fill('The artery measures 2.5 mm.');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-result-error').getByText('Live demo request limit reached.').waitFor();
    assert(await page.locator('#document-progress').isHidden(), 'Failed request kept a completed progress bar');
    assert(await page.locator('#document-result-grid').isHidden(), 'Failed request displayed a stale translation');
    assert((await page.locator('#document-text').inputValue()) === 'The artery measures 2.5 mm.', 'Source text was lost on failure');
    assert(await page.locator('#document-preview img').isVisible(), 'Source image was lost on failure');
    await page.close();
  });

  await check('replacing a document invalidates its pending live draft', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/live/document-excerpt', async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ json: { status: 'ok', message: 'late', translation: '늦은 결과', model: 'test-model', qcSummary: 'review' } }).catch(() => {});
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GZkAAAAASUVORK5CYII=', 'base64');
    await page.locator('#document-file').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: image });
    await page.locator('#document-text').fill('The artery measures 2.5 mm.');
    await page.locator('#document-reviewed').check();
    await page.locator('#document-translate').click();
    await page.locator('#document-progress').waitFor({ state: 'visible' });
    await page.locator('#document-file').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: image });
    await page.waitForTimeout(1000);
    assert(await page.locator('#document-result').isHidden(), 'Old draft appeared for a replacement source');
    assert(await page.locator('#document-progress').isHidden(), 'Old progress survived source replacement');
    await page.close();
  });

  await check('all 18 target previews decode and lead to editable artifacts', async () => {
    const page = await browser.newPage();
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
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert(!(await page.locator('#mobile-sections').isVisible()), 'Mobile navigation appears on desktop');
    assert(await page.locator('.sidebar nav').isVisible(), 'Desktop navigation is hidden');
    await page.close();
  });

  await check('live progress is explicitly estimated until a successful response reaches 100 percent', async () => {
    const page = await browser.newPage();
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
    const page = await browser.newPage();
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
    const page = await browser.newPage();
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
    const page = await browser.newPage();
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
  console.log(`${passed}/${passed} browser checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
