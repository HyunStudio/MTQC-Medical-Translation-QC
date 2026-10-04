import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Refresh only the evidence card. The genuine inference footage is reused
// unchanged; this script never starts the server or sends a model request.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/video/professional-v6');
const timing = JSON.parse(readFileSync(path.join(root, 'output/video/professional-v4/timing.json'), 'utf8'));
const durationSeconds = timing.find(scene => scene.id === '04-evidence')?.duration;
if (!Number.isFinite(durationSeconds) || durationSeconds < 20 || durationSeconds > 40)
  throw new Error('Recorded evidence-scene timing is unavailable or out of bounds.');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .find(candidate => candidate && existsSync(candidate));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH.');
mkdirSync(path.join(output, 'raw'), { recursive: true });

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#0b1d29;color:#edf6f7;font-family:Arial,sans-serif;width:1920px;height:1080px;overflow:hidden}
.grid{position:absolute;inset:0;background-image:linear-gradient(#22505b33 1px,transparent 1px),linear-gradient(90deg,#22505b33 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to right,transparent,#000)}
main{position:relative;padding:100px 125px}.kicker{font-size:23px;letter-spacing:5px;color:#64d5cd}h1{font-size:94px;line-height:1.05;letter-spacing:-4px;margin:38px 0}h1 em{font-style:normal;color:#64d5cd}p{font-size:29px;line-height:1.5;color:#aec5ce;max-width:1540px}.row{display:flex;gap:28px;margin-top:55px}.box{flex:1;padding:34px;border:1px solid #35606b;border-radius:18px;background:#102b37;animation:rise .8s both}.box:nth-child(2){animation-delay:.3s}.box:nth-child(3){animation-delay:.6s}.num{display:block;font-size:60px;color:#71dfd3;margin-bottom:16px}.label{font-size:23px;line-height:1.45}.footer{position:absolute;left:125px;right:125px;bottom:125px;font-size:21px;letter-spacing:1px;color:#8faeb8;border-top:1px solid #34525d;padding-top:22px}@keyframes rise{from{opacity:0;transform:translateY(25px)}to{opacity:1;transform:none}}
</style><div class="grid"></div><main><div class="kicker">QUALITY / TRACEABILITY / HUMAN REVIEW</div><h1>Evidence behind<br><em>every workflow.</em></h1><div class="row"><div class="box"><span class="num">69</span><span class="label">Server regression checks</span></div><div class="box"><span class="num">34</span><span class="label">Browser workflow checks</span></div><div class="box"><span class="num">2</span><span class="label">Model stages in this experimental filmed run</span></div></div><p>Default: Nemotron draft → scoped rules. Optional research lane: separate AI critique.</p><p style="font-size:23px">Paired pilot: 3/3 seeded detections in both arms; no added detection from critique.<br>Warnings rose 7 → 22; limited clean-category false positives 0 → 3. Negation retest 0/2 in both arms.<br>Clinical validation pending · Reviewed excerpts, not full-book reconstruction.</p></main><div class="footer">github.com/HyunStudio/MTQC-Medical-Translation-QC · Anatomy specimen: Servier Medical Art, CC BY 4.0</div></html>`;

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: path.join(output, 'raw'), size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  await page.setContent(html);
  await page.waitForTimeout(500);
  const started = Date.now();
  for (let index = 0; index < 3; index++) {
    await page.waitForTimeout(Math.max(0, (2 + index * 5) * 1000 - (Date.now() - started)));
    await page.locator('.box').evaluateAll((boxes, active) => boxes.forEach((box, i) => {
      box.style.transition = 'border-color .5s, background .5s, transform .5s';
      box.style.borderColor = i === active ? '#70e3d2' : '#35606b';
      box.style.background = i === active ? '#16444e' : '#102b37';
      box.style.transform = i === active ? 'translateY(-8px)' : 'none';
    }), index);
  }
  await page.waitForTimeout(Math.max(0, durationSeconds * 1000 - (Date.now() - started)));
  await page.screenshot({ path: path.join(output, '04-evidence-frame.png') });
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(output, '04-evidence.webm'));
  console.log('Recorded evidence-only scene; no provider request was made.');
} finally {
  await browser.close();
}
