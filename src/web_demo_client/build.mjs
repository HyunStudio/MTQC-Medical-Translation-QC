import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../web_demo/wwwroot/vendor');
const source = (name) => path.join(here, 'node_modules', name);
const copy = (from, to) => {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
};

copy(source('pdfjs-dist/build/pdf.mjs'), path.join(root, 'pdfjs/pdf.mjs'));
copy(source('pdfjs-dist/build/pdf.worker.mjs'), path.join(root, 'pdfjs/pdf.worker.mjs'));
copy(source('pdfjs-dist/LICENSE'), path.join(root, 'pdfjs/LICENSE'));
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
