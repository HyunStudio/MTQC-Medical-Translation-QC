import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverReadingOrder } from '../web_demo/wwwroot/document-layout.mjs';

const word = (text, x, y, width = 180) => ({ text, x, y, width, height: 12 });
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
