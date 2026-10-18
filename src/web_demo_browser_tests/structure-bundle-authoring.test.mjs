import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as authoring from '../web_demo_evaluation/structure-artifact-authoring.mjs';
import { validateReviewedCases } from './structure-replay.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const sourceBytes = new TextEncoder().encode('authored source, not parsed PDF');
  const pageImageBytes = new TextEncoder().encode('authored image, not decoded PNG');
  const request = n => ({ selection: { caseId: `authored-p${n}`, physicalPage: n,
    sourceSha256: hash(sourceBytes), pageImageSha256: hash(pageImageBytes) },
    sourceBytes, pageImageBytes, pageId: 'p1',
    checklist: [{ id: 'coverage', kind: 'fragment-coverage' }, { id: 'formula', kind: 'formula-grouping' }],
    document: { schemaVersion: 1, pages: [{ id: 'p1', width: 400, height: 600,
      fragmentIds: ['p1-f0'], regions: [{ id: 'r', type: 'paragraph', text: 'Observed source text', status: 'proposed',
        provenance: 'pdf-text', fragmentIds: ['p1-f0'], box: { x: 0, y: 0, width: 100, height: 20 } }],
      edges: [], issues: [] }] }, bindings: [{ id: 'coverage', reviewed: false }, { id: 'formula', reviewed: false }] });
  const requests = [request(1), request(5)];
  const cases = requests.map(value => ({ ...value.selection,
    visualReview: { pass1Complete: true, pass2Complete: true }, items: [
      { id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount: 1 } },
      { id: 'formula', kind: 'formula-grouping', expected: { text: 'D95', groups: ['D','95'] } }
    ] }));
  const truthBytes = new TextEncoder().encode(JSON.stringify({ status: 'locked', cases }));
  const manifest = { status: 'locked', truthSha256: hash(truthBytes), cases: requests.map(({ selection }) => ({
    caseId: selection.caseId, page: selection.physicalPage, sourceSha256: selection.sourceSha256,
    pageImageSha256: selection.pageImageSha256, fragmentCount: 1,
    requiredKinds: ['fragment-coverage','formula-grouping'] })) };
  return { manifest, truthBytes, requests };
}
function replaceTruth(request, mutate) {
  const truth = JSON.parse(new TextDecoder().decode(request.truthBytes));
  mutate(truth);
  request.truthBytes = new TextEncoder().encode(JSON.stringify(truth));
  request.manifest.truthSha256 = hash(request.truthBytes);
}

test('complete draft bundle retains exact cases, source graphs, unknown human metrics and serialized SHA', () => {
  const request = fixture();
  assert.equal(typeof authoring.createReviewedBundleDraft, 'function');
  const result = authoring.createReviewedBundleDraft(request);
  assert.equal(result.status, 'DRAFT');
  assert.deepEqual(result.bundle.cases.map(value => value.physicalPage), [1,5]);
  assert.deepEqual(result.bundle.cases[1].document, request.requests[1].document);
  assert.equal(result.bundle.cases[0].bindings[0].reviewed, false);
  assert.deepEqual(result.bundle.manualReview, { eventCapture: 'unavailable', editCount: null, durationSeconds: null });
  assert.equal(result.bundleSha256, hash(new TextEncoder().encode(result.json)));
  assert.deepEqual(JSON.parse(result.json), result.bundle);
  assert.doesNotThrow(() => validateReviewedCases(result.bundle,
    JSON.parse(new TextDecoder().decode(request.truthBytes)).cases, request.manifest.truthSha256));
  assert.equal(result.json.includes('expected'), false);
  assert.equal(result.json.includes('pass1Complete'), false);
  request.requests[1].document.pages[0].regions[0].text = 'later edit';
  assert.equal(result.bundle.cases[1].document.pages[0].regions[0].text, 'Observed source text');
});

test('lock, byte hash and declared human passes are required without inventing a lock', () => {
  for (const mutate of [
    value => { value.manifest.status = 'draft'; },
    value => { value.truthBytes[0] = 0; },
    value => replaceTruth(value, truth => { truth.status = 'draft'; }),
    value => replaceTruth(value, truth => { truth.cases[1].visualReview.pass2Complete = false; }),
    value => replaceTruth(value, truth => { truth.cases[0].visualReview.pass1Complete = 'true'; }),
  ]) {
    const request = fixture(); mutate(request);
    const result = authoring.createReviewedBundleDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'bundle'), false);
    assert.equal(Object.hasOwn(result, 'json'), false);
  }
});

test('missing, extra, duplicate and changed physical source cases reject the entire bundle', () => {
  for (const mutate of [
    value => { value.requests.pop(); },
    value => { value.requests.push(structuredClone(value.requests[0])); },
    value => { value.requests[1].selection.caseId = 'foreign'; },
    value => { value.requests[1].selection.physicalPage = 6; },
    value => { value.requests[1].sourceBytes = new Uint8Array([8]); },
    value => { value.manifest.cases[1].page = 6; },
    value => replaceTruth(value, truth => { delete truth.cases[1].items[1].expected; }),
  ]) {
    const request = fixture(); mutate(request);
    const result = authoring.createReviewedBundleDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'bundle'), false);
  }
});

test('bundle authoring rejects executing getters, lossy arrays and injected answers in late case mappings', () => {
  for (const mutate of [
    value => Object.defineProperty(value, 'manifest', { get() { throw new Error('no getter execution'); } }),
    value => Object.defineProperty(value.requests, '1', { get() { throw new Error('no request array getter'); } }),
    value => { value.requests.extra = 'hidden on serialization'; },
    value => { delete value.requests[1]; },
    value => { value.requests[1].bindings[0].expected = { fragmentCount: 1 }; },
  ]) {
    const request = fixture(); mutate(request);
    const result = authoring.createReviewedBundleDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'bundle'), false);
  }
});

test('well-formed wrong observed coverage and unsupported formulas remain in the full bundle', () => {
  const request = fixture();
  request.requests[0].document.pages[0].regions[0].status = 'verified';
  request.requests[0].document.pages[0].regions[0].fragmentIds = [];
  request.requests[0].bindings.forEach(value => { value.reviewed = true; });
  const result = authoring.createReviewedBundleDraft(request);
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.bundle.cases.length, 2);
  assert.deepEqual(result.bundle.cases[0].document.pages[0].regions[0].fragmentIds, []);
  assert.equal(result.bundle.cases[0].bindings[1].reviewed, true);
});

test('locked truth cannot request coverage allocation beyond the graph fragment boundary', () => {
  const request = fixture();
  request.manifest.cases[0].fragmentCount = 8193;
  replaceTruth(request, truth => { truth.cases[0].items[0].expected.fragmentCount = 8193; });
  request.requests[0].document.pages[0].regions[0].status = 'verified';
  request.requests[0].bindings[0].reviewed = true;
  const result = authoring.createReviewedBundleDraft(request);
  assert.equal(result.status, 'ABSTAIN');
  assert.equal(Object.hasOwn(result, 'bundle'), false);
});
