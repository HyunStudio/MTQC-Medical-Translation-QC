import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const output = path.resolve(process.argv[2] || 'output/gallery-clean-20261002.png');
const base = process.argv[3] || 'https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/';
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .find(candidate => candidate && existsSync(candidate));
if (!chrome) throw new Error('Set CHROME_PATH to an installed Chrome executable.');
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#language-select').selectOption('zh-CN');
  await page.locator('#workbench').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.locator('img[src*="servier-visual-zh-CN.png"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('#workbench img')].every(image => image.complete && image.naturalWidth > 0));
  mkdirSync(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await browser.close();
}
