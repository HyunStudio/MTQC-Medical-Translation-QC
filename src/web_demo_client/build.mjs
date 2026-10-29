import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../web_demo/wwwroot/vendor');
const source = (name) => path.join(here, 'node_modules', name);
const copy = (from, to) => {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
};

if (!process.argv.includes('--codec-only')) {
copy(source('pdfjs-dist/build/pdf.mjs'), path.join(root, 'pdfjs/pdf.mjs'));
copy(source('pdfjs-dist/build/pdf.worker.mjs'), path.join(root, 'pdfjs/pdf.worker.mjs'));
copy(source('pdfjs-dist/LICENSE'), path.join(root, 'pdfjs/LICENSE'));
for (const directory of ['wasm', 'standard_fonts', 'cmaps']) {
  copy(source(`pdfjs-dist/${directory}`), path.join(root, 'pdfjs', directory));
}
copy(source('tesseract.js/dist/tesseract.esm.min.js'), path.join(root, 'tesseract/tesseract.esm.min.js'));
copy(source('tesseract.js/dist/worker.min.js'), path.join(root, 'tesseract/worker.min.js'));
copy(source('tesseract.js/LICENSE.md'), path.join(root, 'tesseract/LICENSE.md'));
const coreSource = source('tesseract.js-core');
const coreTarget = path.join(root, 'tesseract/core');
mkdirSync(coreTarget, { recursive: true });
for (const name of readdirSync(coreSource)) {
  if (name.endsWith('.wasm') || name.endsWith('.wasm.js') || name === 'LICENSE') {
    copyFileSync(path.join(coreSource, name), path.join(coreTarget, name));
  }
}
copy(source('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(root, 'tesseract/lang/eng.traineddata.gz'));
console.log(`Local document workers copied to ${root}`);

}

// Local PDF export codec; keep transitive MIT/Zlib notices with the bundle.
copy(source('pdf-lib/dist/pdf-lib.esm.min.js'), path.join(root, 'pdf-lib/pdf-lib.esm.min.mjs'));
for (const name of ['pdf-lib', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib']) {
  const dir=source(name);
  for (const file of readdirSync(dir)) {
    if (/^(LICENSE|CopyrightNotice)/i.test(file)) copy(path.join(dir,file), path.join(root,'pdf-lib/notices',name.replaceAll('/','-'),file));
  }
}
