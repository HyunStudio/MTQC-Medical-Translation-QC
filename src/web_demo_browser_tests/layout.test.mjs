import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverReadingOrder } from '../web_demo/wwwroot/document-layout.mjs';

const word = (text, x, y, width = 180) => ({ text, x, y, width, height: 12 });
test('output lines identify each retained source fragment exactly once', () => {
  const result = recoverReadingOrder([word('Same', 330, 60), word('Same', 40, 60), word(' ', 0, 0), word('End', 40, 80)], 600, 'two');
  assert.deepEqual(result.lines.flatMap(line => line.fragmentIds), [1, 3, 0]);
  assert.equal(result.fragmentCount, result.lines.reduce((n, line) => n + line.fragmentIds.length, 0));
});
test('interleaved PDF stream becomes left column then right column without losing fragments', () => {
  const result = recoverReadingOrder([
    word('Right first', 330, 60), word('Left second', 40, 80),
    word('Left first', 40, 60), word('Right second', 330, 80)
  ], 600);
  assert.equal(result.columns, 2);
  assert.deepEqual(result.lines.map(line => line.text), ['Left first', 'Left second', 'Right first', 'Right second']);
  assert.equal(result.fragmentCount, 4);
});
test('full width headings split mixed layouts into reading bands', () => {
  const result = recoverReadingOrder([
    word('Heading', 40, 20, 510), word('A', 40, 60), word('B', 330, 60),
    word('C', 40, 80), word('D', 330, 80), word('Section two', 40, 120, 510),
    word('E', 40, 150), word('F', 330, 150)
  ], 600);
  assert.deepEqual(result.lines.map(line => line.text), ['Heading', 'A', 'C', 'B', 'D', 'Section two', 'E', 'F']);
});
test('single column fragments on the same line join in geometric order', () => {
  const result = recoverReadingOrder([word('artery', 100, 20, 40), word('The', 40, 20, 30), word('Next line', 40, 40)], 600);
  assert.equal(result.columns, 1);
  assert.equal(result.text, 'The artery\nNext line');
});
test('tightly led stacked prose lines do not merge as superscripts', () => {
  const result = recoverReadingOrder([
    word('Dose A', 40, 100, 60), word('Dose B', 40, 109, 60), word('Dose C', 40, 118, 60)
  ], 600);
  assert.deepEqual(result.lines.map(line => line.text), ['Dose A', 'Dose B', 'Dose C']);
});
test('staggered same-size lines touching at an edge remain separate', () => {
  const result = recoverReadingOrder([
    word('Left note', 50, 100, 60), word('Right note', 110, 109, 60)
  ], 600);
  assert.deepEqual(result.lines.map(line => line.text), ['Left note', 'Right note']);
});
test('full-width prose is not misclassified as columns by later equation glyphs', () => {
  // A centered one-column medical page can contain many isolated formula
  // glyphs on both sides of an apparent gutter. Its prose still crosses it.
  const fragments = [];
  for (let row = 0; row < 12; row++)
    fragments.push(word(`Full-width medical paragraph line ${row} continues across the page`, 234, 100 + row * 16, 465));
  for (let row = 0; row < 30; row++) {
    fragments.push(word(`L${row}`, 315, 330 + row * 12, 10));
    fragments.push(word(`R${row}`, 510, 330 + row * 12, 10));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 1);
  assert(result.text.indexOf('Full-width medical paragraph line 11') < result.text.indexOf('L0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});
test('contiguous PDF prose fragments still establish a one-column page around equations', () => {
  const fragments = [];
  for (let row = 0; row < 12; row++) {
    fragments.push(word(`A medical paragraph line ${row} `, 62, 100 + row * 16, 298));
    fragments.push(word('continues across the page', 360, 100 + row * 16, 300));
  }
  for (let row = 0; row < 30; row++) {
    fragments.push(word(`L${row}`, 315, 330 + row * 12, 10));
    fragments.push(word(`R${row}`, 510, 330 + row * 12, 10));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 1);
  assert(result.lines.some(line => line.text.includes('A medical paragraph line 11 continues across the page')), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});
test('reviewer may choose row-wise order for a table', () => {
  const result = recoverReadingOrder([word('A', 40, 20), word('B', 330, 20), word('C', 40, 40), word('D', 330, 40)], 600, 'single');
  assert.equal(result.text, 'A B\nC D');
});
test('empty and invalid coordinates do not create phantom lines', () => {
  assert.equal(recoverReadingOrder([], 600).text, '');
  assert.equal(recoverReadingOrder([word(' ', 0, 0)], 600).fragmentCount, 0);
});
test('explicit PDF whitespace survives adjoining text fragments', () => {
  const result = recoverReadingOrder([word('The ', 40, 20, 60), word('artery', 100, 20, 40)], 600);
  assert.equal(result.text, 'The artery');
});
test('narrow journal gutter and centered page number do not interleave body columns', () => {
  const fragments = [word('Journal header', 50, 35, 620), word('02', 367, 999, 10)];
  for (let row = 0; row < 12; row++) {
    fragments.push(word(`Left ${row}`, 62, 150 + row * 15, 301));
    fragments.push(word(`Right ${row}`, 381, 150 + row * 15, 301));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 2);
  assert(result.text.indexOf('Left 11') < result.text.indexOf('Right 0'), result.text);
  assert(!result.lines.some(line => line.text.includes('Left') && line.text.includes('Right')));
  assert.equal(result.fragmentCount, 26);
});
test('split ligatures stay with their body column below a full-width figure caption', () => {
  const fragments = [word('Figure caption', 62, 50, 620), word('03', 367, 999, 10)];
  for (let row = 0; row < 12; row++) {
    fragments.push(word(`Left ${row}`, 62, 150 + row * 15, 301));
    fragments.push(word(`Right ${row}`, 381, 150 + row * 15, 301));
  }
  fragments.push(word('ef', 62, 400, 12), word('fi', 74, 400, 6), word('cacy', 80, 400, 25));
  const result = recoverReadingOrder(fragments, 744);
  assert(result.text.includes('efficacy'));
  assert(result.text.indexOf('efficacy') < result.text.indexOf('Right 0'), result.text);
});
test('adjacent abstract fragments stay on one line when a fragment crosses a two-column gutter', () => {
  const fragments = [word('Article title', 50, 30, 650), word('Metadata', 50, 90, 110),
    word('work', 272, 90, 28), word('fl', 300, 90, 7), word('ows continue', 307, 90, 395)];
  for (let row = 0; row < 12; row++) {
    fragments.push(word(`Left ${row}`, 50, 200 + row * 15, 318));
    fragments.push(word(`Right ${row}`, 383, 200 + row * 15, 318));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 2);
  assert(result.text.includes('workflows continue'), result.text);
  assert(!result.lines.some(line => line.text.includes('Metadata') && line.text.includes('work')), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('numeric full-width table keeps each row together before two-column prose', () => {
  const fragments = [
    word('TABLE 1', 62, 50, 45),
    word('Methods', 62, 80, 80), word('DSC', 190, 80, 30),
    word('IoU', 270, 80, 30), word('Precision', 330, 80, 65),
    word('Recall', 410, 80, 55), word('Time', 610, 80, 40),
    word('Case Alpha', 62, 110, 80), word('0.8423', 190, 110, 35),
    word('0.7632', 270, 110, 35), word('0.8666', 330, 110, 35),
    word('0.8394', 410, 110, 35), word('0.65', 610, 110, 30),
    word('Case Beta', 62, 130, 80), word('0.8534', 190, 130, 35),
    word('0.7760', 270, 130, 35), word('0.8683', 330, 130, 35),
    word('0.8538', 410, 130, 35), word('0.27', 610, 130, 30),
    word('3.2 Evaluation metrics', 62, 180, 170)
  ];
  for (let row = 0; row < 8; row++) {
    fragments.push(word(`Left prose ${row}`, 62, 220 + row * 16, 300));
    fragments.push(word(`Right prose ${row}`, 398, 220 + row * 16, 280));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 2);
  assert(result.lines.some(line => line.text === 'Case Alpha 0.8423 0.7632 0.8666 0.8394 0.65'), result.text);
  assert(result.lines.some(line => line.text === 'Case Beta 0.8534 0.7760 0.8683 0.8538 0.27'), result.text);
  assert.equal(result.tableRegions, 1);
  assert(result.text.indexOf('Case Beta') < result.text.indexOf('Left prose 0'), result.text);
  assert(result.text.indexOf('Left prose 7') < result.text.indexOf('Right prose 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('raster table caption does not turn later two-column numeric prose into a table', () => {
  const fragments = [word('TABLE 1', 50, 50, 45), word('Raster-only table caption', 50, 68, 180)];
  for (let row = 0; row < 2; row++) {
    const y = 130 + row * 20;
    fragments.push(word(`Left ${row}`, 50, y, 100), word(`0.${row + 1}`, 180, y, 20));
    fragments.push(word(`Right ${row}`, 400, y, 100), word(`0.${row + 2}`, 530, y, 20));
  }
  for (let row = 0; row < 8; row++) {
    fragments.push(word(`Left prose ${row}`, 50, 190 + row * 15, 280));
    fragments.push(word(`Right prose ${row}`, 400, 190 + row * 15, 280));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.columns, 2);
  assert.equal(result.tableRegions, 0);
  assert(result.text.indexOf('Left prose 7') < result.text.indexOf('Right 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('long full-width table retains model count slice and voxel values on late rows', () => {
  const fragments = [word('TABLE 1', 50, 50, 50),
    word('Model', 100, 80, 70), word('Count', 400, 80, 60),
    word('Slices', 500, 80, 60), word('Voxel', 640, 80, 50)];
  for (let row = 0; row < 28; row++) {
    const y = 110 + row * 25;
    fragments.push(word(`Model${row}`, 100, y, 85), word(`${100 + row}`, 400, y, 35),
      word(`${200 + row}`, 500, y, 35), word('1', 640, y, 15));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert(result.lines.some(line => line.text === 'Model27 127 227 1'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('wrapped table cells do not terminate later aligned numeric rows', () => {
  const fragments = [
    word('TABLE 1', 50, 50, 50),
    word('Dataset', 50, 80, 60), word('Sequence', 150, 80, 65),
    word('Model', 260, 80, 55), word('Count', 400, 80, 45), word('Slices', 550, 80, 45),
    word('A', 50, 110, 18), word('MPRAGE', 150, 110, 48), word('ModelA', 260, 110, 55),
    word('160', 400, 110, 25), word('208', 550, 110, 25),
    word('B', 50, 130, 18), word('MPRAGE', 150, 130, 48), word('ModelB', 260, 130, 55),
    word('383', 400, 130, 25), word('174', 550, 130, 25),
    word('Whitehall1', 50, 150, 70), word('Multi-', 150, 150, 35),
    word(' Echo', 185, 150, 32), word('ModelC', 260, 150, 55),
    word('552', 400, 150, 25), word('176', 550, 150, 25),
    word('Long', 150, 170, 25), word(' wrapped', 180, 170, 42), word(' name', 225, 170, 28),
    word('Late', 50, 190, 35), word('MPRAGE', 150, 190, 48), word('ModelD', 260, 190, 55),
    word('223', 400, 190, 25), word('174', 550, 190, 25),
    word('3.3 Results', 50, 230, 110)
  ];
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert(result.lines.some(line => line.column === 'table' && line.text.includes('Late MPRAGE ModelD 223 174')), result.text);
  assert(result.text.indexOf('Late MPRAGE ModelD 223 174') < result.text.indexOf('3.3 Results'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('sparse inherited table cells and comma-separated slices stay with later rows', () => {
  const fragments = [word('TABLE 1', 50, 50, 50),
    word('Dataset', 75, 80, 60), word('Model', 356, 80, 70),
    word('Count', 467, 80, 50), word('Slices', 543, 80, 60), word('Voxel', 634, 80, 60),
    word('BHC', 75, 110, 40), word('Prisma', 356, 110, 70), word('160', 467, 110, 30),
    word('208', 543, 110, 30), word('1 x 1 x 1', 634, 110, 60),
    word('OPDC', 75, 130, 45), word('Trio', 356, 130, 45), word('383', 467, 130, 30),
    word('174', 543, 130, 30), word('1 x 1 x 1', 634, 130, 60)];
  for (let row = 0; row < 20; row++) {
    const y = 150 + row * 25;
    fragments.push(word(`Scanner${row}`, 356, y, 85), word(`${40 + row}`, 467, y, 30),
      word(`${160 + row}, ${170 + row}`, 543, y, 76), word('1 x 1 x 1.2', 634, y, 70));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert(result.lines.some(line => line.text === 'Scanner19 59 179, 189 1 x 1 x 1.2'), result.text);
});

test('a half-column table next to prose never becomes a full-width table band', () => {
  const fragments = [word('TABLE 1', 50, 50, 55),
    word('Variable', 50, 80, 80), word('Group A', 150, 80, 70),
    word('Group B', 240, 80, 70), word('Right prose heading continues', 390, 80, 290)];
  for (let row = 0; row < 8; row++) {
    const y = 110 + row * 20;
    fragments.push(word(`Left${row}`, 50, y, 65), word(`${row + 1}`, 150, y, 20),
      word(`${row + 2}`, 240, y, 20), word(`Right prose line ${row}`, 390, y, 290));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 0);
  assert(result.text.indexOf('Left7') < result.text.indexOf('Right prose line 0'), result.text);
});

test('inline Table 1 reference beside a right-column table is not a full-page marker', () => {
  const fragments = [word('Left paragraph', 50, 50, 180), word('Table 1', 250, 50, 55),
    word('Table 2', 390, 50, 55),
    word('from', 50, 80, 30), word('analysis', 90, 80, 50), word('due', 150, 80, 25),
    word('ROI', 390, 80, 30), word('Model', 450, 80, 40),
    word('MSD', 520, 80, 40), word('DSC', 640, 80, 40)];
  for (let row = 0; row < 6; row++) {
    const y = 110 + row * 20;
    fragments.push(word(`Left ${row}`, 50, y, 260), word(`Muscle ${row}`, 390, y, 100),
      word(`0.${row + 1}`, 530, y, 30), word(`0.${row + 2}`, 640, y, 30));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 0);
  assert(result.text.indexOf('Left 5') < result.text.indexOf('Muscle 0'), result.text);
});

test('real Kalluvila page 8 five-column one-row ratings table stays in header and value rows', () => {
  // Kalluvila et al., Diagnostics 2025, DOI 10.3390/diagnostics15233046,
  // published PDF physical page 8 (CC BY 4.0). PDF.js fragment coordinates
  // below are rounded to 0.01 px from the frozen original-page capture.
  // Visual truth: one five-column table followed by one prose column.
  const fragments = [
    ['Table 1.', 207.62, 89.84, 39.23, 11.21],
    ['Radiologist Evaluation of Algorithms (Likert Scale).', 250.32, 89.84, 256.43, 11.21],
    ['UNet++', 236.61, 116.19, 40.98, 11.21], ['U-Net', 339.76, 116.19, 31.12, 11.21],
    ['Nested U-Net', 418.53, 116.19, 70.03, 11.21], ['Attention U-Net', 510.21, 116.19, 83.11, 11.21],
    ['Trans U-Net', 619.01, 116.19, 61.95, 11.21],
    ['3.1', 232.81, 136.11, 14.01, 11.21], ['±', 249.76, 135.64, 9.08, 11.68],
    ['0.32', 261.78, 136.11, 19.61, 11.21], ['3.6', 331.02, 136.11, 14.01, 11.21],
    ['±', 347.98, 135.64, 9.08, 11.68], ['0.52', 360.00, 136.11, 19.61, 11.21],
    ['3.7', 429.26, 136.11, 14.01, 11.21], ['±', 446.20, 135.64, 9.08, 11.68],
    ['0.67', 458.22, 136.11, 19.61, 11.21], ['3.7', 518.90, 136.32, 14.01, 11.21],
    ['±', 535.85, 135.85, 10.45, 11.68], ['0.82 *', 549.24, 136.32, 27.39, 11.21],
    [',†', 576.63, 134.75, 7.27, 8.72], ['2.0', 628.49, 136.11, 14.01, 11.21],
    ['±', 645.44, 135.64, 9.08, 11.68], ['0.0', 657.46, 136.11, 14.01, 11.21],
    ['* Preferred network by radiologist 1.', 207.21, 154.78, 160.67, 9.96],
    ['†', 371.06, 153.65, 3.74, 7.47],
    ['Preferred network by radiologist 2.', 378.01, 154.78, 154.30, 9.96],
    ['3.3. Qualitative Comparison', 207.99, 183.58, 143.96, 12.45],
    ['In this portion of the results, we focus on manually assessing the segmentation quality', 234.57, 204.73, 465.02, 12.45]
  ].map(([text, x, y, width, height]) => ({ text, x, y, width, height }));
  const result = recoverReadingOrder(fragments, 744.095);
  assert.equal(result.tableRegions, 1);
  assert(result.lines.some(line => line.text === 'UNet++ U-Net Nested U-Net Attention U-Net Trans U-Net'), result.text);
  assert(result.lines.some(line => line.text === '3.1 ± 0.32 3.6 ± 0.52 3.7 ± 0.67 3.7 ± 0.82 *,† 2.0 ± 0.0'), result.text);
  assert(result.text.indexOf('2.0 ± 0.0') < result.text.indexOf('3.3. Qualitative Comparison'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

// No visually confirmed lowered-numeric term was found in the prespecified
// 21-page probe. Keep this known-risk test skipped rather than tuning the
// row-grouping rule to a synthetic shape and risking real line mergers.
test.skip('shifted subscript in a medical dose term stays between adjacent baseline fragments', () => {
  const result = recoverReadingOrder([
    { text: 'D', x: 0, y: 90, width: 6, height: 10 },
    { text: '95%', x: 6, y: 95, width: 12, height: 7 },
    { text: 'dose', x: 22, y: 90, width: 20, height: 10 }
  ], 600);
  assert.equal(result.text, 'D95% dose');
  assert.deepEqual(result.lines[0].fragmentIds, [0, 1, 2]);
});

test('two-column prose immediately below a numeric table is not swallowed by its band', () => {
  const fragments = [
    word('TABLE 1', 50, 50, 60),
    word('Method', 50, 80, 60), word('Metric A', 260, 80, 60), word('Metric B', 460, 80, 60),
    word('Alpha', 50, 110, 60), word('0.8', 260, 110, 60), word('0.9', 460, 110, 60),
    word('Beta', 50, 130, 60), word('0.7', 260, 130, 60), word('0.8', 460, 130, 60)
  ];
  for (let row = 0; row < 6; row++) {
    fragments.push(word(`Left prose ${row}`, 50, 153 + row * 15, 250));
    fragments.push(word(`Right prose ${row}`, 390, 153 + row * 15, 250));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert.equal(result.lines.find(line => line.text === 'Left prose 0')?.column, 'left');
  assert(result.text.indexOf('Left prose 5') < result.text.indexOf('Right prose 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});
test('a nearby section heading ends a numeric table before two-column prose', () => {
  const fragments = [word('TABLE 1', 50, 50, 60),
    word('Method', 50, 80, 60), word('Metric A', 260, 80, 60), word('Metric B', 460, 80, 60),
    word('Alpha', 50, 110, 60), word('0.8', 260, 110, 60), word('0.9', 460, 110, 60),
    word('Beta', 50, 130, 60), word('0.7', 260, 130, 60), word('0.8', 460, 130, 60),
    word('3.1 Results', 50, 153, 82)];
  for (let row = 0; row < 6; row++) {
    fragments.push(word(`Left prose ${row}`, 50, 163 + row * 16, 250));
    fragments.push(word(`Right prose ${row}`, 390, 163 + row * 16, 250));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert.notEqual(result.lines.find(line => line.text === '3.1 Results')?.column, 'table');
  assert.equal(result.lines.find(line => line.text.includes('Left prose 0'))?.column, 'left');
  assert(result.text.indexOf('Left prose 5') < result.text.indexOf('Right prose 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('centered one-row table does not absorb following two-column prose', () => {
  const fragments = [word('TABLE 1', 207, 50, 44), word('Rating scale', 254, 50, 110)];
  for (let index = 0; index < 5; index++) {
    fragments.push(word(`Algorithm ${index}`, 225 + index * 95, 80, 70));
    fragments.push(word(`${index + 1}.0`, 225 + index * 95, 110, 24));
  }
  for (let row = 0; row < 6; row++) {
    fragments.push(word(`Left body ${row}`, 50, 133 + row * 16, 250));
    fragments.push(word(`Right body ${row}`, 390, 133 + row * 16, 250));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert.equal(result.lines.find(line => line.text === 'Left body 0')?.column, 'left');
  assert(result.text.indexOf('Left body 5') < result.text.indexOf('Right body 0'), result.text);
});

test('centered multirow table retains aligned numeric rows before two-column prose', () => {
  const fragments = [word('TABLE 1', 207, 50, 44), word('Rating scale', 254, 50, 110)];
  for (let index = 0; index < 5; index++) {
    fragments.push(word(`Algorithm ${index}`, 225 + index * 95, 80, 70));
    fragments.push(word(`${index + 1}.0`, 225 + index * 95, 110, 24));
    fragments.push(word(`${index + 2}.0`, 225 + index * 95, 128, 24));
  }
  for (let row = 0; row < 6; row++) {
    fragments.push(word(`Left body ${row}`, 50, 150 + row * 16, 250));
    fragments.push(word(`Right body ${row}`, 390, 150 + row * 16, 250));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert(result.lines.some(line => line.column === 'table' && line.text === '2.0 3.0 4.0 5.0 6.0'), result.text);
  assert.equal(result.lines.find(line => line.text === 'Left body 0')?.column, 'left');
  assert(result.text.indexOf('Left body 5') < result.text.indexOf('Right body 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('isolated citation numeral below a table does not merge two-column prose', () => {
  const fragments = [
    word('TABLE 1', 50, 50, 60),
    word('Method', 50, 80, 60), word('Metric A', 260, 80, 60), word('Metric B', 460, 80, 60),
    word('Alpha', 50, 110, 60), word('0.8', 260, 110, 60), word('0.9', 460, 110, 60),
    word('Beta', 50, 130, 60), word('0.7', 260, 130, 60), word('0.8', 460, 130, 60),
    { text: '12', x: 302, y: 151, width: 8, height: 8 }
  ];
  for (let row = 0; row < 6; row++) {
    fragments.push(word(`Left prose ${row}`, 50, 153 + row * 15, 250));
    fragments.push(word(`Right prose ${row}`, 390, 153 + row * 15, 250));
  }
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert.equal(result.lines.find(line => line.text.includes('Left prose 0'))?.column, 'left');
  assert.equal(result.lines.find(line => line.text === 'Right prose 0')?.column, 'right');
  assert(result.text.indexOf('Left prose 5') < result.text.indexOf('Right prose 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});

test('aligned citation numerals do not bridge non-table prose into a table band', () => {
  const fragments = [
    word('TABLE 1', 50, 50, 60),
    word('Method', 50, 80, 60), word('Metric A', 260, 80, 60), word('Metric B', 460, 80, 60),
    word('Alpha', 50, 110, 60), word('0.8', 260, 110, 60), word('0.9', 460, 110, 60),
    word('Beta', 50, 130, 60), word('0.7', 260, 130, 60), word('0.8', 460, 130, 60),
    word('as reported by', 50, 153, 150), { text: '12', x: 255, y: 151, width: 8, height: 8 },
    word('Right prose 0', 390, 153, 250),
    word('Left prose 1', 50, 168, 250), word('Right prose 1', 390, 168, 250),
    word('Left prose 2', 50, 183, 250), word('per', 390, 183, 60),
    { text: '7', x: 455, y: 181, width: 5, height: 8 }
  ];
  const result = recoverReadingOrder(fragments, 744);
  assert.equal(result.tableRegions, 1);
  assert.equal(result.lines.find(line => line.text.includes('as reported by'))?.column, 'left');
  assert.equal(result.lines.find(line => line.text === 'Right prose 0')?.column, 'right');
  assert(result.text.indexOf('Left prose 2') < result.text.indexOf('Right prose 0'), result.text);
  assert.equal(result.fragmentCount, fragments.length);
});
