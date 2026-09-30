import test from 'node:test';
import assert from 'node:assert/strict';
const quality = await import('./corpus-quality.mjs').catch(() => null);
const evaluate = (record, allowed = {}) => {
  assert(quality, 'Independent corpus quality gate is missing');
  return quality.evaluateQuality(record, allowed);
};
const record = {id:'known-scan',characters:50,anchors:[{anchor:'Heading',found:true},{anchor:'Caption',found:false}],order:[]};
const allowed = {'known-scan':{anchors:['Caption'],order:[]}};
test('known OCR failure does not exempt a newly missing heading', () => {
  assert.deepEqual(evaluate(record,allowed),[]);
  assert.deepEqual(evaluate({...record,anchors:record.anchors.map(a=>({...a,found:false}))},allowed),['Missing anchor: Heading']);
});
test('empty known-case extraction fails the content gate', () => {
  assert(evaluate({...record,characters:0},allowed).includes('Empty extraction'));
});
test('new reading-order failure is not hidden by an anchor allowance', () => {
  assert.deepEqual(evaluate({...record,order:[{before:'A',after:'B',pass:false}]},allowed),['Reading order: A -> B']);
});
test('unannotated corpus case fails closed', () => {
  assert(evaluate({id:'new',characters:20}).includes('Missing source annotations'));
});
test('same-length fragment substitution catches missing duplicate and foreign IDs', () => {
  assert(quality, 'Independent fragment coverage check is missing');
  assert.deepEqual(quality.fragmentCoverage([0,1,2],[0,0,9]),{missing:[1,2],duplicates:[0],unexpected:[9]});
  assert.deepEqual(quality.fragmentCoverage([0,1,2],[2,0,1]),{missing:[],duplicates:[],unexpected:[]});
});
