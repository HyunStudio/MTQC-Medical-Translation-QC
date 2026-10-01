import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Authentic UI capture. No intercepted, fabricated, or replayed model response.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/video/professional-v4');
const story = JSON.parse(readFileSync(path.join(output, 'timing.json'), 'utf8'));
if (!process.env.NEBIUS_API_KEY?.trim()) throw new Error('A process-held Nebius key is required; it is never recorded.');
const app = path.join(root, 'src/web_demo');
const build = spawnSync('dotnet', ['build', path.join(app, 'MedicalQcWebDemo.csproj'), '-c', 'Release', '--nologo'], { stdio: 'inherit' });
if (build.status) throw new Error('Build failed');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const ledger = path.join(output, `attempt-ledger-${Date.now()}.json`);
mkdirSync(path.join(output, 'raw'), { recursive: true });
const server = spawn('dotnet', [path.join(app, 'bin/Release/net10.0/MedicalQcWebDemo.dll'), '--urls', base], {
  cwd: app, stdio: 'ignore', env: { ...process.env, DEMO_LIVE_ENABLED: 'true', DEMO_LIVE_PER_CLIENT_LIMIT: '2',
    DEMO_LIVE_TOTAL_ATTEMPTS: '2', DEMO_LIVE_LEDGER_PATH: ledger }
});
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(candidate => candidate && existsSync(candidate));
let browser;
const evidence = { capturedAt: new Date().toISOString(), browserRequests: 0, reservedProviderAttempts: 2,
  scenes: [], source: 'Original synthetic teaching specimen; not clinical reference' };

const card = (body) => `<!doctype html><html><style>
*{box-sizing:border-box}body{margin:0;background:#0b1d29;color:#edf6f7;font-family:Arial,sans-serif;width:1920px;height:1080px;overflow:hidden}
.grid{position:absolute;inset:0;background-image:linear-gradient(#22505b33 1px,transparent 1px),linear-gradient(90deg,#22505b33 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to right,transparent,#000)}
main{position:relative;padding:100px 125px}.kicker{font-size:23px;letter-spacing:5px;color:#64d5cd}h1{font-size:94px;line-height:1.05;letter-spacing:-4px;margin:38px 0}h1 em{font-style:normal;color:#64d5cd}p{font-size:30px;line-height:1.5;color:#aec5ce;max-width:1430px}.row{display:flex;gap:28px;margin-top:55px}.box{flex:1;padding:34px;border:1px solid #35606b;border-radius:18px;background:#102b37;animation:rise .8s both}.box:nth-child(2){animation-delay:.3s}.box:nth-child(3){animation-delay:.6s}.num{display:block;font-size:60px;color:#71dfd3;margin-bottom:16px}.label{font-size:23px;line-height:1.45}.footer{position:absolute;left:125px;right:125px;bottom:125px;font-size:21px;letter-spacing:1px;color:#8faeb8;border-top:1px solid #34525d;padding-top:22px}@keyframes rise{from{opacity:0;transform:translateY(25px)}to{opacity:1;transform:none}}
</style><div class="grid"></div>${body}</html>`;

async function scene(index, prepare, perform) {
  const config = story[index];
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(output, 'raw'), size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await prepare(page);
  await page.waitForTimeout(500);
  const started = Date.now();
  const until = async seconds => page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - started)));
  if (index === 0 || index === 3) await highlightCards(page, config, until);
  await perform(page, config, until, () => (Date.now() - started) / 1000);
  await until(config.duration);
  const elapsed = (Date.now() - started) / 1000;
  if (elapsed > config.duration + 2) throw new Error(`Scene ${config.id} overran narration: ${elapsed}s`);
  await page.screenshot({ path: path.join(output, `${config.id}-frame.png`) });
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(output, `${config.id}.webm`));
  evidence.scenes.push({ id: config.id, seconds: elapsed });
  console.log(`Captured ${config.id}: ${elapsed.toFixed(1)}s`);
}

async function highlightCards(page, config, until) {
  for (let index = 0; index < 3; index++) {
    await until(2 + index * (config.duration - 5) / 3);
    await page.locator('.box').evaluateAll((boxes, active) => boxes.forEach((box, i) => {
      box.style.transition = 'border-color .5s, background .5s, transform .5s';
      box.style.borderColor = i === active ? '#70e3d2' : '#35606b';
      box.style.background = i === active ? '#16444e' : '#102b37';
      box.style.transform = i === active ? 'translateY(-8px)' : 'none';
    }), index);
  }
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await (await fetch(base + '/api/live/status')).json()).available) break; } catch {}
    if (i === 99) throw new Error('Local live server unavailable');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const maker = await browser.newPage();
  await maker.setContent(`<style>body{font:17px Arial;color:#173a49;margin:38px}h1{font-size:28px;border-bottom:3px solid #148d94;padding-bottom:15px}small{color:#547783}main{display:grid;grid-template-columns:1fr 1fr;gap:48px}h2{font-size:20px;color:#087b85}p{line-height:1.55}svg{width:100%;height:100px}</style><small>MTQC / ORIGINAL SYNTHETIC TEACHING SPECIMEN</small><h1>Vascular anatomy and document review</h1><main><section><h2>Proximal anatomy</h2><p>The proximal artery measures 2.5 mm. The distal vein measures 1.8 mm.</p><p>Keep anatomical direction and measurements attached to the correct vessel.</p><svg viewBox="0 0 300 100"><path d="M20 50 Q90 10 150 50 T280 50" stroke="#168b9e" stroke-width="20" fill="none"/><circle cx="50" cy="37" r="9" fill="#c94a5a"/><circle cx="250" cy="65" r="9" fill="#c94a5a"/></svg><p>Figure: abstract vessel illustration.</p></section><section><h2>Review sequence</h2><p>Inspect the source image and its reading order before translation.</p><p>Confirm numbers, anatomy, and labels in the translated excerpt.</p><p>This is fictional demonstration content. It is not patient data or a clinical reference.</p></section></main>`);
  const pdf = await maker.pdf({ format: 'A4', printBackground: true });
  await maker.close();
  await scene(0, page => page.setContent(card('<main><div class="kicker">HYUNSTUDIO / NEBIUS × NVIDIA</div><h1>Medical knowledge.<br><em>Visible quality.</em></h1><p>MTQC — Medical Textbook Translation & Quality Control</p><div class="row"><div class="box"><span class="num">01</span><span class="label">Compare original<br>and translated visuals</span></div><div class="box"><span class="num">02</span><span class="label">Inspect document<br>reading order</span></div><div class="box"><span class="num">03</span><span class="label">Review multilingual<br>AI drafts with evidence</span></div></div></main><div class="footer">WORKING RESEARCH PROTOTYPE · ENGLISH SOURCE + 18 TARGET LANGUAGES</div>')), async () => {});
  await scene(1, async page => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#workbench').evaluate(element => element.scrollIntoView());
  }, async (page, config, until, elapsed) => {
    await until(5);
    await page.locator('#language-select').selectOption('es');
    await until(10);
    await page.locator('#language-select').selectOption('ar');
    await until(16);
    await page.locator('#language-select').selectOption('zh-CN');
    await until(21);
    await page.locator('#download-link').scrollIntoViewIfNeeded();
  });
  await scene(2, async page => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#try-document').evaluate(element => element.scrollIntoView());
  }, async (page, config, until, elapsed) => {
    await page.locator('#document-file').setInputFiles({ name: 'vascular-teaching-specimen.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => document.querySelector('#document-layout-summary')?.textContent.includes('column(s)'));
    await until(config.sentenceStarts[1]);
    await page.locator('#document-order-mode').selectOption('single');
    await page.waitForTimeout(1400);
    await page.locator('#document-order-mode').selectOption('auto');
    await until(config.sentenceStarts[2]);
    await page.locator('#document-text').fill('The proximal artery measures 2.5 mm. The distal vein measures 1.8 mm.');
    await page.locator('#document-language').selectOption('ar');
    await page.locator('#document-reviewed').check();
    await until(config.sentenceStarts[3]);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/live/document-excerpt') && response.request().method() === 'POST', { timeout: 90000 });
    await page.locator('#document-translate').click();
    await page.locator('#document-progress').scrollIntoViewIfNeeded();
    evidence.browserRequests++;
    const response = await responsePromise;
    const result = await response.json();
    if (!response.ok() || result.status !== 'ok' || !result.translation ||
        result.review?.translationStage?.state !== 'completed' ||
        result.review?.critiqueStage?.state !== 'completed' ||
        result.review?.rulesStage?.state !== 'completed' ||
        !result.review?.translationStage?.model?.includes('Nemotron') ||
        !result.review?.critiqueStage?.model?.includes('Nemotron'))
      throw new Error('Genuine two-stage review did not complete; no staged replacement is allowed.');
    evidence.liveResult = { status: result.status, runId: result.review.runId,
      translationStage: result.review.translationStage, critiqueStage: result.review.critiqueStage,
      rulesStage: result.review.rulesStage, ruleCoverage: result.review.coverage,
      modelSuggestionCount: result.review.modelFindings?.length ?? 0 };
    await page.locator('#document-progress-track[aria-valuenow="100"]').waitFor();
    const firstReviewAt = Math.max(36, elapsed() + 2);
    await until(firstReviewAt);
    await page.locator('#document-result-grid').scrollIntoViewIfNeeded();
    await until(firstReviewAt + 7);
    await page.locator('#document-review-stages').scrollIntoViewIfNeeded();
    await until(firstReviewAt + 14);
    await page.locator('#document-human-acknowledge').check();
    await until(firstReviewAt + 21);
    await page.locator('#document-coverage').scrollIntoViewIfNeeded();
    await until(firstReviewAt + 28);
    await page.locator('#document-result-grid').scrollIntoViewIfNeeded();
  });
  await scene(3, page => page.setContent(card('<main><div class="kicker">QUALITY / TRACEABILITY / HUMAN REVIEW</div><h1>Evidence behind<br><em>every workflow.</em></h1><div class="row"><div class="box"><span class="num">66</span><span class="label">Server regression checks</span></div><div class="box"><span class="num">33</span><span class="label">Browser workflow checks</span></div><div class="box"><span class="num">2</span><span class="label">Real sequential model stages</span></div></div><p>Local extraction → approved excerpt → NVIDIA Nemotron draft → separate critique → scoped rules</p><p style="font-size:23px">Controlled pilot: no added detection from critique; model suggestions stay unverified.<br>Clinical validation pending · Live scope: reviewed excerpts, not full-book reconstruction.</p></main><div class="footer">github.com/HyunStudio/MTQC-Medical-Translation-QC · Anatomy specimen: Servier Medical Art, CC BY 4.0</div>')), async () => {});
  writeFileSync(path.join(output, 'recording-evidence.json'), JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
