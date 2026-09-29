import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

// Records genuine browser OCR and one genuine server-side Nebius request. No API key is embedded in the video or source.
if (!process.env.NEBIUS_API_KEY?.trim()) throw new Error('Set NEBIUS_API_KEY in this process before recording.');
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const appDir = path.join(projectRoot, 'src/web_demo');
const appDll = path.join(appDir, 'bin/Release/net10.0/MedicalQcWebDemo.dll');
const output = path.join(projectRoot, 'output/video');
mkdirSync(output, { recursive: true });
const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe')
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH.');

const build = spawnSync('dotnet', ['build', path.join(appDir, 'MedicalQcWebDemo.csproj'), '-c', 'Release', '--nologo'], { cwd: appDir, stdio: 'inherit' });
if (build.status !== 0 || !existsSync(appDll)) throw new Error('Release app build failed.');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn('dotnet', [appDll, '--urls', base], {
  cwd: appDir,
  env: { ...process.env, DEMO_LIVE_ENABLED: 'true', DEMO_LIVE_PER_CLIENT_LIMIT: '1' },
  stdio: 'ignore'
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Server exited before recording.');
    try {
      const status = await (await fetch(base + '/api/live/status')).json();
      if (status.available) { ready = true; break; }
    } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  if (!ready) throw new Error('Live server did not start.');
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const sourceContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(pathToFileURL(path.join(projectRoot, 'docs/web-demo/assets/original-circulation-demo.svg')).href);
  const specimenPng = path.join(output, 'original-circulation-demo.png');
  await sourcePage.locator('svg').screenshot({ path: specimenPng });
  await sourceContext.close();

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: output, size: { width: 1440, height: 900 } },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  await page.locator('a[href="#try-document"]').first().click();
  await page.waitForTimeout(700);
  await page.locator('#document-file').setInputFiles(specimenPng);
  await page.locator('#document-status').getByText(/Local English OCR .*Review and correct/).waitFor({ timeout: 30000 });
  if ((await page.locator('#document-text').inputValue()).trim().length < 5) throw new Error('Local OCR produced no source text.');
  await page.waitForTimeout(800);
  await page.locator('#document-text').fill('The proximal artery measures 2.5 mm. The distal vein measures 1.8 mm.');
  await page.locator('#document-language').selectOption('ar');
  await page.locator('#document-reviewed').check();
  await page.waitForTimeout(700);
  await page.locator('#document-translate').click();
  await page.locator('#document-result').waitFor({ state: 'visible', timeout: 35000 });
  const model = await page.locator('#document-result-model').textContent();
  if (!model?.includes('Nemotron')) throw new Error('Genuine Nemotron response was not shown.');
  await page.waitForTimeout(4000);
  await page.locator('#document-result').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(output, 'submission-final-frame.png'), fullPage: false });
  const video = page.video();
  await page.close();
  await context.close();
  const finalPath = path.join(output, 'medical-qc-final-live-demo-v2.webm');
  await video.saveAs(finalPath);
  console.log(`Genuine live demo recorded: ${finalPath}`);
} finally {
  await browser?.close();
  server.kill();
}
