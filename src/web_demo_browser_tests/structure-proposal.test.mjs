import test from 'node:test';
import assert from 'node:assert/strict';
import { proposePageStructure } from '../web_demo/wwwroot/document-structure-proposal.mjs';

const word = (text, x, y, width = 120) => ({ text, x, y, width, height: 12 });
const input = (fragments, extra = {}) => ({ pageIndex: 0, width: 744, height: 900,
  fragments, hasImages: false, ocrText: '', ...extra });
const issueCodes = page => page.issues.map(issue => issue.code);

test('one-column proposal owns every PDF fragment once and verifies nothing', () => {
  const page = proposePageStructure(input([word('Source title', 60, 20, 580),
    word('The artery', 60, 60, 250), word('measures 2 mm.', 60, 80, 250)]));
  assert.equal(page.id, 'p1');
  assert.deepEqual(page.fragmentIds, ['p1-f0', 'p1-f1', 'p1-f2']);
  assert.deepEqual(page.regions.flatMap(region => region.fragmentIds).sort(), [...page.fragmentIds].sort());
  assert(page.regions.every(region => region.status !== 'verified'));
  assert(page.edges.every(edge => edge.status === 'proposed'));
  assert.equal(page.visualInventoryConfirmed, false);
});

test('two-column proposal preserves left-column then right-column sequence', () => {
  const page = proposePageStructure(input([word('Right first', 390, 60, 260),
    word('Left second', 60, 80, 260), word('Left first', 60, 60, 260),
    word('Right second', 390, 80, 260)]));
  assert.deepEqual(page.regions.map(region => region.text),
    ['Left first', 'Left second', 'Right first', 'Right second']);
  assert.deepEqual(page.regions.flatMap(region => region.fragmentIds).sort(), [...page.fragmentIds].sort());
});

test('full-width numeric table is a region but its cell grid remains unresolved', () => {
  const fragments = [word('TABLE 1', 62, 50, 45),
    word('Method', 62, 80, 75), word('DSC', 190, 80, 30),
    word('Precision', 330, 80, 65), word('Recall', 410, 80, 55),
    word('Case A', 62, 110, 80), word('0.84', 190, 110, 35),
    word('0.86', 330, 110, 35), word('0.83', 410, 110, 35),
    word('Case B', 62, 130, 80), word('0.85', 190, 130, 35),
    word('0.87', 330, 130, 35), word('0.84', 410, 130, 35)];
  const page = proposePageStructure(input(fragments));
  assert(page.regions.some(region => region.type === 'table' && region.fragmentIds.length >= 8));
  assert(issueCodes(page).includes('table-grid-unverified'));
  assert.deepEqual(page.regions.flatMap(region => region.fragmentIds).sort(), [...page.fragmentIds].sort());
});

test('a glyph fragment crossing a gutter is neither lost nor duplicated', () => {
  const page = proposePageStructure(input([word('Title', 50, 20, 650),
    word('Metadata', 50, 90, 110), word('work', 272, 90, 28),
    word('fl', 300, 90, 7), word('ows continue', 307, 90, 395),
    ...Array.from({ length: 8 }, (_, row) => [
      word(`Left ${row}`, 50, 200 + row * 15, 318),
      word(`Right ${row}`, 383, 200 + row * 15, 318)
    ]).flat()]));
  assert.deepEqual(page.regions.flatMap(region => region.fragmentIds).sort(), [...page.fragmentIds].sort());
  assert(page.regions.some(region => region.text.includes('workflows continue')));
});

test('raster figure beside a caption remains unassessed without invented labels', () => {
  const page = proposePageStructure(input([word('Figure 1. Anatomy', 60, 300, 350)], { hasImages: true }));
  assert.equal(page.regions[0].type, 'caption');
  assert(issueCodes(page).includes('raster-content-unassessed'));
  assert(issueCodes(page).includes('caption-link-unresolved'));
  assert(!page.regions.some(region => region.type === 'figure' && region.status === 'verified'));
});

test('OCR-only page is a local unresolved clue rather than a verified transcription', () => {
  const page = proposePageStructure(input([], { ocrText: 'The artery measures 12 mm.' }));
  assert.equal(page.regions.length, 1);
  assert.equal(page.regions[0].provenance, 'local-ocr');
  assert.equal(page.regions[0].status, 'unresolved');
  assert(issueCodes(page).includes('ocr-order-unverified'));
});

test('searchable text with an image and empty OCR still has an unresolved page issue', () => {
  const page = proposePageStructure(input([word('Body text', 60, 60, 280)], { hasImages: true, ocrText: '' }));
  assert(issueCodes(page).includes('raster-content-unassessed'));
  assert(!page.visualInventoryConfirmed);
});

test('nonempty PDF fragment with invalid geometry is not silently discarded', () => {
  const page = proposePageStructure(input([word('Valid', 60, 60), word('Visible but unplaced', NaN, 80)]));
  assert.equal(page.fragmentIds.length, 2);
  assert(issueCodes(page).includes('unplaced-fragment'));
  assert.equal(page.regions.flatMap(region => region.fragmentIds).length, 1);
});
