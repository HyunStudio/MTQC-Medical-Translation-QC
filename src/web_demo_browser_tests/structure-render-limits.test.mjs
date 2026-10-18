import test from 'node:test';
import assert from 'node:assert/strict';
import { validRenderDimensions, fitSourceCrop } from '../web_demo/wwwroot/document-render-limits.mjs';

test('render limits bound area and each axis independently', () => {
  assert.equal(validRenderDimensions(2480, 3508), true);
  assert.equal(validRenderDimensions(3000, 4000), true);
  assert.equal(validRenderDimensions(3001, 4000), false);
  assert.equal(validRenderDimensions(125000, 13), false);
  assert.equal(validRenderDimensions(13, 125000), false);
  for (const [width, height] of [[0, 10], [-1, 10], [NaN, 10], [Infinity, 10], [10, undefined], ['10', 10]])
    assert.equal(validRenderDimensions(width, height), false);
});

test('source crops preserve ordinary enlargement and bound both bitmap sides', () => {
  assert.deepEqual(fitSourceCrop(200, 100), { width: 400, height: 200 });
  assert.deepEqual(fitSourceCrop(1000, 500), { width: 800, height: 400 });
  assert.deepEqual(fitSourceCrop(1, 24000), { width: 1, height: 800 });
  assert.deepEqual(fitSourceCrop(24000, 1), { width: 800, height: 1 });
  assert.equal(fitSourceCrop(0, 10), null);
  assert.equal(fitSourceCrop(10, Infinity), null);
});
