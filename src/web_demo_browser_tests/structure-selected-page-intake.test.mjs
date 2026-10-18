import test from 'node:test';
import { imageMaskControlPdf as maskPdf } from './authored-pdf-controls.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSelectedPageReviewDraft } from '../web_demo_evaluation/structure-selected-page-intake.mjs';
import { pageHasRasterImages } from '../web_demo/wwwroot/document-raster-operators.mjs';

const require = createRequire(new URL('../web_demo_client/package.json', import.meta.url));
const { createCanvas } = require('@napi-rs/canvas');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Hand-authored five-page PDF, not a held-out original or human truth fixture.
function authoredPdf({ userUnit = 1, blank = false } = {}) {
  const objects = [null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R 12 0 R] /Count 5 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let n = 1; n <= 5; n++) {
    const text = n === 5 ? 'I' : `PAGE ${n}`;
    const stream = blank ? '' : `BT /F1 12 Tf 30 60 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /UserUnit ${userUnit} ${n === 5 ? '/CropBox [10 20 210 320] /MediaBox [0 0 400 400] /Rotate 90' : '/MediaBox [0 0 200 300]'} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (n-1)*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (let n = 1; n < objects.length; n++) {
    offsets.push(Buffer.byteLength(text)); text += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
function selection(source, physicalPage = 5) {
  const frame = physicalPage === 5
    ? { viewBox: [10,20,210,320], rotation: 90, scale: 1, transform: [0,1,1,0,-20,-10], width: 300, height: 200 }
    : { viewBox: [0,0,200,300], rotation: 0, scale: 1.25, transform: [1.25,0,0,-1.25,0,375], width: 250, height: 375 };
  const canvas = createCanvas(frame.width, frame.height);
  canvas.getContext('2d').fillRect(0, 0, 3, 3); // Deliberately NOT a PDF rendering.
  const canonicalImageBytes = new Uint8Array(canvas.toBuffer('image/png'));
  return { identity: { caseId: `authored-physical-${physicalPage}`, physicalPage,
    sourceSha256: hash(source), pageImageSha256: hash(canonicalImageBytes) }, canonicalImageBytes, frame };
}
const request = () => { const sourceBytes = authoredPdf(); return { sourceBytes, selections: [selection(sourceBytes)] }; };

function noOutput(value) {
  assert.equal(value.status, 'ABSTAIN');
  for (const key of ['pages','document','sourceBytes','json']) assert.equal(Object.hasOwn(value, key), false);
}

test('actual full PDF page5 retains crop/rotation/native quadrilateral in local p1 without certifying canonical pixels', async () => {
  const result = await createSelectedPageReviewDraft(request());
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.sourcePageCount, 5);
  assert.equal(result.pages[0].identity.physicalPage, 5);
  assert.equal(result.pages[0].pageId, 'p1');
  assert.deepEqual(result.pages[0].frame.transform, [0,1,1,0,-20,-10]);
  const fragment = result.pages[0].record.fragments[0];
  assert.equal(fragment.text, 'I');
  assert.equal(fragment.x, 40); assert.equal(fragment.y, 20);
  assert.equal(fragment.width, 12); assert.ok(Math.abs(fragment.height - 3.336) < 0.001);
  assert.equal(result.pages[0].nativeFragments[0].id, 'p1-f0');
  assert.deepEqual(result.pages[0].nativeFragments[0].pdfTransform, [12,0,0,12,30,60]);
  assert.equal(result.document.pages[0].id, 'p1');
  assert.deepEqual(result.document.pages[0].fragmentIds, ['p1-f0']);
  assert.ok(result.document.pages[0].regions.every(value => value.status !== 'verified'));
  assert.equal(result.document.pages[0].visualInventoryConfirmed, false);
  assert.equal(result.pages[0].sourceRenderEquivalence, 'unverified');
  assert.equal(result.pages[0].canonicalFragmentCrosswalk, 'unavailable');
  assert.equal(result.manualReview.eventCapture, 'unavailable');
  assert.equal(result.manualReview.editCount, null);
  assert.notEqual(hash(result.pages[0].previewPngBytes), result.pages[0].identity.pageImageSha256);
});

test('two selected physical pages have separate identities in selection order, never sliced-PDF aliases', async () => {
  const value = request(); value.selections.push(selection(value.sourceBytes, 1));
  const result = await createSelectedPageReviewDraft(value);
  assert.equal(result.status, 'DRAFT');
  assert.deepEqual(result.pages.map(value => [value.identity.physicalPage,value.pageId]), [[5,'p1'],[1,'p2']]);
  assert.equal(result.pages[1].record.fragments[0].text, 'PAGE 1');
  assert.deepEqual(result.document.pages.map(value => value.id), ['p1','p2']);
  assert.equal(result.pages[1].identity.sourceSha256, hash(value.sourceBytes));
});

test('later invalid page, duplicate selection, changed bytes or coordinate declaration produce no partial draft', async () => {
  for (const mutate of [
    value => { value.selections.push(selection(value.sourceBytes, 6)); },
    value => { value.selections.push(selection(value.sourceBytes, 5)); },
    value => { value.sourceBytes[0] = 0; },
    value => { value.selections[0].canonicalImageBytes[0] = 0; },
    value => { value.selections[0].frame.transform[4] = 0; },
    value => { value.selections[0].frame.rotation = 0; },
    value => { value.selections[0].frame.viewBox[0] = 0; },
    value => { value.selections[0].frame.width = 301; }
  ]) { const value = request(); mutate(value); noOutput(await createSelectedPageReviewDraft(value)); }
});

test('bad PNG decoding and bounded dimensions are rejected before any review records return', async () => {
  for (const mutate of [
    value => { value.selections[0].canonicalImageBytes = value.selections[0].canonicalImageBytes.slice(0,33); },
    value => { value.selections[0].canonicalImageBytes[16] = 0x7f; },
    value => { value.selections[0].frame.scale = 10000; },
    value => { value.sourceBytes = new Uint8Array(16 * 1024 * 1024 + 1); }
  ]) {
    const value = request(); mutate(value);
    value.selections[0].identity.sourceSha256 = hash(value.sourceBytes);
    value.selections[0].identity.pageImageSha256 = hash(value.selections[0].canonicalImageBytes);
    noOutput(await createSelectedPageReviewDraft(value));
  }
});

test('snapshot before async parse resists caller mutation and byte override methods; getters are not executed', async () => {
  const value = request(), originalHash = hash(value.sourceBytes);
  value.sourceBytes.slice = () => { throw new Error('Caller byte method'); };
  const pending = createSelectedPageReviewDraft(value);
  value.sourceBytes.fill(0); value.selections[0].frame.transform.fill(0);
  value.selections[0].identity.caseId = 'changed'; value.selections[0].canonicalImageBytes.fill(0);
  const result = await pending;
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.pages[0].identity.caseId, 'authored-physical-5');
  assert.equal(result.pages[0].identity.sourceSha256, originalHash);
  let reads = 0;
  const malicious = request();
  Object.defineProperty(malicious.selections[0].frame, 'scale', { enumerable: true, get() { reads++; return 1; } });
  noOutput(await createSelectedPageReviewDraft(malicious));
  const top = request(); Object.defineProperty(top,'sourceBytes',{enumerable:true,get(){reads++;return authoredPdf();}});
  noOutput(await createSelectedPageReviewDraft(top));
  assert.equal(reads, 0);
});

test('PDF UserUnit scales the full native glyph quadrilateral, including advance width', async () => {
  const sourceBytes = authoredPdf({ userUnit: 2 });
  const selected = selection(sourceBytes);
  selected.frame = { viewBox: [10,20,210,320], rotation: 90, scale: 1,
    transform: [0,2,2,0,-40,-20], width: 600, height: 400 };
  selected.canonicalImageBytes = new Uint8Array(createCanvas(600,400).toBuffer('image/png'));
  selected.identity.pageImageSha256 = hash(selected.canonicalImageBytes);
  const result = await createSelectedPageReviewDraft({ sourceBytes, selections: [selected] });
  assert.equal(result.status, 'DRAFT');
  const fragment = result.pages[0].record.fragments[0];
  assert.equal(fragment.x, 80); assert.equal(fragment.y, 40); assert.equal(fragment.width, 24);
  assert.ok(Math.abs(fragment.height - 6.672) < 0.001, `actual height ${fragment.height}`);
  assert.equal(result.pages[0].pdfUserUnit, 2);
});

test('blank PDF remains empty/unassessed without manufactured OCR fragments or review coverage', async () => {
  const sourceBytes = authoredPdf({ blank: true });
  const result = await createSelectedPageReviewDraft({ sourceBytes, selections: [selection(sourceBytes)] });
  assert.equal(result.status, 'DRAFT');
  assert.deepEqual(result.pages[0].nativeFragments, []);
  assert.deepEqual(result.document.pages[0].fragmentIds, []);
  assert.deepEqual(result.document.pages[0].regions, []);
  assert.ok(result.document.pages[0].issues.some(value => value.code === 'empty-page-unassessed'));
  assert.equal(result.document.pages[0].visualInventoryConfirmed, false);
  assert.equal(result.pages[0].record.ocrText, '');
});

test('unsupported vertical native text is held without a misleading horizontal quadrilateral', async () => {
  const stream = text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-V /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /DW2 [880 -1000] >>',
    stream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0041> <0041> <0042> <0042> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end'),
    stream('BT /F1 20 Tf 1 0 0 1 100 200 Tm <00410042> Tj ET')
  ];
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (let n = 0; n < objects.length; n++) {
    offsets.push(Buffer.byteLength(text)); text += `${n+1} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  const sourceBytes = new Uint8Array(Buffer.from(text));
  const canonicalImageBytes = new Uint8Array(createCanvas(300,300).toBuffer('image/png'));
  const value = { sourceBytes, selections: [{ canonicalImageBytes,
    identity: { caseId: 'authored-vertical', physicalPage: 1,
      sourceSha256: hash(sourceBytes), pageImageSha256: hash(canonicalImageBytes) },
    frame: { viewBox: [0,0,300,300], rotation: 0, scale: 1, transform: [1,0,0,-1,0,300], width: 300, height: 300 } }] };
  const result = await createSelectedPageReviewDraft(value);
  noOutput(result);
  assert.equal(result.reason, 'UNSUPPORTED_VERTICAL_TEXT');
});

test('original solid-color PDF image mask and caption now hold without a draft', async () => {
  const sourceBytes = maskPdf();
  const canonicalImageBytes = new Uint8Array(createCanvas(300,300).toBuffer('image/png'));
  const result = await createSelectedPageReviewDraft({ sourceBytes, selections: [{ canonicalImageBytes,
    identity: { caseId: 'authored-mask', physicalPage: 1, sourceSha256: hash(sourceBytes), pageImageSha256: hash(canonicalImageBytes) },
    frame: { viewBox: [0,0,300,300], rotation: 0, scale: 1, transform: [1,0,0,-1,0,300], width: 300, height: 300 } }] });
  assert.deepEqual(result, { status: 'ABSTAIN', reason: 'EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED' });
});

test('all pinned PDF.js raster paint operations require inventory while vector paint alone does not', async () => {
  const { OPS } = await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject',
    'paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup',
    'paintInlineImageXObjectGroup','paintSolidColorImageMask']) {
    assert.equal(pageHasRasterImages(OPS, [OPS.save,OPS[name],OPS.restore]), true, name);
  }
  assert.equal(pageHasRasterImages(OPS, [OPS.save,OPS.transform,OPS.fill,OPS.restore]), false);
});
