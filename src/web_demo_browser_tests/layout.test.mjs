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
