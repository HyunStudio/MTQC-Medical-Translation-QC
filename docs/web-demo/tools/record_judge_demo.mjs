// Capture an authentic local browser session; the server owns the API key.
// Usage: node record_judge_demo.mjs BASE_URL OUTPUT.webm
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = require(path.resolve(here, '../../../src/web_demo_browser_tests/node_modules/playwright-core'));
const base = process.argv[2];
const output = process.argv[3];
if (!base || !output) throw new Error('Usage: node record_judge_demo.mjs BASE_URL OUTPUT.webm');
const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);
const chrome = chromeCandidates.find(existsSync);
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

const outputPath = path.resolve(output);
const tempVideoDir = path.join(path.dirname(outputPath), 'raw');
mkdirSync(path.dirname(outputPath), { recursive: true });
mkdirSync(tempVideoDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: tempVideoDir, size: { width: 1440, height: 900 } },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const video = page.video();
let liveObserved = false;

async function caption(message) {
  await page.evaluate(text => {
    let box = document.getElementById('judge-guide');
    if (!box) {
      box = document.createElement('div');
      box.id = 'judge-guide';
      box.style.cssText = [
        'position:fixed', 'left:14px', 'bottom:108px', 'z-index:2147483647',
        'max-width:210px', 'padding:12px 13px', 'border-radius:10px',
        'background:rgba(11,59,71,.97)', 'color:white', 'border:1px solid #5bc7be',
        'font:600 15px/1.3 Arial,sans-serif', 'box-shadow:0 8px 28px #061a2447',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(box);
    }
    box.textContent = text;
  }, message);
}

try {
  await page.goto(new URL('/?case=mueller-figure1&lang=ko', base).toString(), { waitUntil: 'networkidle' });
  await page.locator('#source-preview').waitFor();
  const status = await page.request.get(new URL('/api/live/status', base).toString());
  const availability = await status.json();
  if (!availability.available) throw new Error('Live mode is not configured; do not label a mock as a real model call');

  await caption('1 / Recorded output opens instantly - no API key needed');
  await page.waitForTimeout(1800);
  await page.locator('#workbench').scrollIntoViewIfNeeded();
  await page.mouse.move(660, 460, { steps: 12 });
  await caption('2 / Compare original page and translated Figure 1');
  await page.waitForTimeout(2800);
  await page.locator('#language-select').selectOption('ar');
  await caption('3 / Switch target to Arabic - right-to-left draft');
  await page.waitForTimeout(2600);
  await page.locator('#theme-toggle').click();
  await caption('4 / Light and dark review modes');
  await page.waitForTimeout(1400);
  await page.locator('#theme-toggle').click();
  await page.locator('#live-run').scrollIntoViewIfNeeded();
  await caption('5 / Real fixed-caption call to NVIDIA Nemotron on Nebius');
  await page.waitForTimeout(1200);
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/live/excerpt') && response.request().method() === 'POST',
    { timeout: 30000 });
  await page.locator('#live-run').click();
  await page.locator('#live-progress').waitFor({ state: 'visible', timeout: 5000 });
  const response = await responsePromise;
  const result = await response.json();
  if (result.status !== 'ok' || result.model !== 'nvidia/Nemotron-3_5-Lightning') {
    throw new Error(`Live call did not complete with the configured NVIDIA model: ${result.status}`);
  }
  await page.locator('#live-result').waitFor({ state: 'visible' });
  await page.locator('#live-progress-track[aria-valuenow="100"]').waitFor();
  liveObserved = true;
  await caption('6 / 100% means response received, not medical approval');
  await page.waitForTimeout(3200);
  await page.locator('#evidence').scrollIntoViewIfNeeded();
  await caption('7 / QC findings link back to the source and draft');
  await page.waitForTimeout(2500);
  await page.close();
  await context.close();
  await video.saveAs(outputPath);
  console.log(JSON.stringify({
    output: outputPath, liveObserved, model: result.model,
    promptTokens: result.promptTokens, completionTokens: result.completionTokens,
  }));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
