import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as authoring from '../web_demo_evaluation/structure-artifact-authoring.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function input() {
  const sourceBytes = new TextEncoder().encode('authored source bytes, not a parsed PDF');
  const pageImageBytes = new TextEncoder().encode('authored render bytes, not a decoded PNG');
  return { selection: { caseId: 'authored-p5', sourceSha256: hash(sourceBytes),
    pageImageSha256: hash(pageImageBytes), physicalPage: 5 }, sourceBytes, pageImageBytes,
    pageId: 'p1', checklist: [{ id: 'coverage', kind: 'fragment-coverage' }, { id: 'formula', kind: 'formula-grouping' }],
    document: { schemaVersion: 1, selectedRegionIds: [], pages: [{ id: 'p1', width: 400, height: 600,
      fragmentIds: ['p1-f0'], regions: [{ id: 'r', type: 'paragraph', text: 'Visible', status: 'proposed',
        box: { x: 10, y: 10, width: 100, height: 30 }, fragmentIds: ['p1-f0'], provenance: 'pdf-text' }], edges: [], issues: [] }] },
    bindings: [{ id: 'coverage', reviewed: false }, { id: 'formula', reviewed: false }] };
}

test('draft authoring binds actual bytes and snapshots graph state without inventing review authority', () => {
  const request = input();
  const before = structuredClone(request.document);
  assert.equal(typeof authoring.createReviewedArtifactDraft, 'function');
  const result = authoring.createReviewedArtifactDraft(request);
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.artifact.physicalPage, 5);
  assert.equal(result.artifact.pageId, 'p1');
  assert.deepEqual(result.artifact.document, before);
  assert.equal(result.artifact.bindings[0].reviewed, false);
  assert.equal(result.observations[0].status, 'unresolved');
  assert.equal(Object.hasOwn(result.artifact, 'visualReview'), false);
  request.document.pages[0].regions[0].text = 'later mutation';
  request.bindings[0].reviewed = true;
  request.sourceBytes[0] = 0;
  assert.deepEqual(result.artifact.document, before);
  assert.equal(result.artifact.bindings[0].reviewed, false);
});

test('different actual source or render bytes produce no artifact', () => {
  for (const field of ['sourceBytes', 'pageImageBytes']) {
    const request = input(); request[field][0] = 0;
    const result = authoring.createReviewedArtifactDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(result.reason, field === 'sourceBytes' ? 'SOURCE_BYTES_MISMATCH' : 'PAGE_IMAGE_BYTES_MISMATCH');
    assert.equal(Object.hasOwn(result, 'artifact'), false);
  }
});

test('caller slice, iterator and shadowed length cannot substitute different bytes', () => {
  const request = input();
  const wrong = new TextEncoder().encode('changed actual source');
  wrong.slice = () => request.sourceBytes;
  wrong[Symbol.iterator] = () => request.sourceBytes[Symbol.iterator]();
  Object.defineProperty(wrong, 'length', { value: request.sourceBytes.length });
  request.sourceBytes = wrong;
  assert.equal(authoring.createReviewedArtifactDraft(request).reason, 'SOURCE_BYTES_MISMATCH');
});

test('answer fields are rejected without reading or copying them into an artifact', () => {
  const request = input();
  Object.defineProperty(request.checklist[0], 'expected', { get() { throw new Error('must not read answer'); } });
  assert.deepEqual(authoring.createReviewedArtifactDraft(request), { status: 'ABSTAIN', reason: 'CHECKLIST_NOT_ID_ONLY' });
});

test('bindings and canonical ID maps cannot carry expected answers or arbitrary values', () => {
  for (const mutate of [
    value => { value.bindings[0].expected = { fragmentCount: 1 }; },
    value => Object.defineProperty(value.bindings[0], 'expected', { get() { throw new Error('must not read'); } }),
    value => { value.bindings[0].canonicalRegionIds = [{ id: 'r', canonicalId: 'original-r', text: 'answer' }]; },
    value => { value.bindings[0].canonicalRegionIds = [{ id: 'r', canonicalId: 'original-r', expected: 'answer' }]; },
  ]) {
    const request = input(); mutate(request);
    assert.deepEqual(authoring.createReviewedArtifactDraft(request), { status: 'ABSTAIN', reason: 'BINDINGS_NOT_ID_ONLY' });
  }
});

test('top-level getters cannot substitute unchecked mapping or selection after validation', () => {
  for (const field of ['bindings', 'selection']) {
    const request = input(), first = request[field];
    let reads = 0;
    Object.defineProperty(request, field, { enumerable: true, get() {
      reads++;
      return reads === 1 ? first : field === 'bindings'
        ? [{ ...first[0], expected: { fragmentCount: 1 } }, first[1]]
        : { ...first, physicalPage: 0 };
    } });
    const result = authoring.createReviewedArtifactDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'artifact'), false);
    assert.equal(reads, 0);
  }
});

test('JSON-hidden object evidence and non-JSON array properties reject instead of disappearing', () => {
  for (const mutate of [
    value => Object.defineProperty(value.document, 'sourceNote', { value: 'evidence', enumerable: false }),
    value => { value.document.pages.sourceNote = 'evidence'; },
    value => { delete value.document.pages[0].fragmentIds[0]; },
    value => Object.defineProperty(value.bindings[0], 'reviewed', { value: true, enumerable: false }),
    value => { value.document.pages[0].fragmentIds.extra = 'x'.repeat(262145); },
    value => { value.document.pages[0].regions[0].fragmentIds = new Array(1); },
  ]) {
    const request = input(); mutate(request);
    const result = authoring.createReviewedArtifactDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'artifact'), false);
  }
});

test('ambiguous maps, unsupported source inputs and invalid bounds fail without a partial draft', () => {
  for (const mutate of [
    value => { value.document.pages.push(structuredClone(value.document.pages[0])); },
    value => { value.selection.physicalPage = 0; },
    value => { value.pageId = 'missing'; },
    value => { value.sourceBytes = new DataView(new ArrayBuffer(8)); },
    value => { value.pageImageBytes = new Uint8Array(10 * 1024 * 1024 + 1); },
    value => { value.document.pages[0].width = Infinity; },
    value => { value.document.pages[0].width = 32768; },
    value => { value.bindings.push({ ...value.bindings[0] }); }
  ]) {
    const request = input(); mutate(request);
    const result = authoring.createReviewedArtifactDraft(request);
    assert.equal(result.status, 'ABSTAIN');
    assert.equal(Object.hasOwn(result, 'artifact'), false);
  }
});
