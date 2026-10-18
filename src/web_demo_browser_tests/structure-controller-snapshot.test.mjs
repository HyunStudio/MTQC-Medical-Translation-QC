import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePrivateSourcePages, createPrivateReviewSnapshot } from '../web_demo/wwwroot/document-private-review-snapshot.mjs';

function fixture() {
  const document = { schemaVersion: 1, selectedRegionIds: [], pages: [{ id: 'p1', width: 300, height: 200,
    fragmentIds: ['p1-f0'], visualInventoryConfirmed: false, regions: [{ id: 'p1-r0', type: 'paragraph',
      box: { x: 40, y: 20, width: 12, height: 3.336 }, text: 'I', status: 'proposed',
      fragmentIds: ['p1-f0'], provenance: 'pdf-text', exclusionReason: '' }], edges: [], issues: [] }] };
  const sourcePages = [{ caseId: 'authored-physical-5', physicalPage: 5, pageId: 'p1',
    sourceSha256: 'a'.repeat(64), pageImageSha256: 'b'.repeat(64), pdfUserUnit: 1,
    frame: { viewBox: [10,20,210,320], rotation: 90, scale: 1, transform: [0,1,1,0,-20,-10], width: 300, height: 200 },
    nativeFragmentIds: ['p1-f0'], sourceRenderEquivalence: 'unverified', canonicalFragmentCrosswalk: 'unavailable' }];
  return { document, sourcePages, sourceGeneration: 1 };
}
function abstain(result) {
  assert.equal(result.status, 'ABSTAIN');
  for (const key of ['document','sourcePages','manualReview']) assert.equal(Object.hasOwn(result,key), false);
}

test('private snapshot isolates physical source/frame/native inventory and proposed graph without human timing claims', () => {
  const value = fixture(), result = createPrivateReviewSnapshot(value);
  assert.equal(result.status,'DRAFT');
  value.document.pages[0].regions[0].text = 'Caller mutation';
  value.sourcePages[0].frame.transform[4] = 0; value.sourcePages[0].caseId = 'Caller case';
  assert.equal(result.document.pages[0].regions[0].text, 'I');
  assert.equal(result.sourcePages[0].caseId,'authored-physical-5');
  assert.equal(result.sourcePages[0].physicalPage,5);
  assert.equal(result.sourcePages[0].pageId,'p1');
  assert.deepEqual(result.sourcePages[0].frame.transform,[0,1,1,0,-20,-10]);
  assert.equal(result.sourceGeneration,1);
  assert.equal(result.document.pages[0].regions[0].status,'proposed');
  assert.equal(result.sourcePages[0].sourceRenderEquivalence,'unverified');
  assert.deepEqual(result.manualReview,{ eventCapture:'unavailable',editCount:null,durationSeconds:null });
});

test('missing, ambiguous or substituted declared source association emits no private snapshot', () => {
  for (const mutate of [
    value => { value.sourcePages = null; },
    value => { value.sourcePages = []; },
    value => { value.sourcePages[0].pageId = 'p5'; },
    value => { value.sourcePages[0].physicalPage = 0; },
    value => { value.sourcePages[0].sourceSha256 = 'not a digest'; },
    value => { value.sourcePages[0].sourceRenderEquivalence = 'verified'; },
    value => { value.sourcePages[0].canonicalFragmentCrosswalk = 'verified'; },
    value => { value.sourceGeneration = 0; },
    value => { value.sourceGeneration = Number.MAX_SAFE_INTEGER + 1; }
  ]) { const value = fixture(); mutate(value); abstain(createPrivateReviewSnapshot(value)); }
});

test('matrix, UserUnit, dimensions and native fragment association are checked against the entire snapshot', () => {
  for (const mutate of [
    value => { value.sourcePages[0].frame.transform[4] = 0; },
    value => { value.sourcePages[0].pdfUserUnit = 2; },
    value => { value.sourcePages[0].frame.width = 301; },
    value => { value.sourcePages[0].nativeFragmentIds = ['p1-f1']; },
    value => { value.document.pages[0].fragmentIds.push('p1-f1'); },
    value => { value.document.pages[0].regions[0].fragmentIds = ['foreign-f0']; },
    value => { value.document.pages[0].regions[0].box.width = 400; }
  ]) { const value = fixture(); mutate(value); abstain(createPrivateReviewSnapshot(value)); }
});

test('source sidecar snapshot rejects unexpected answers, getters and non-JSON data without executing them', () => {
  let reads = 0;
  for (const mutate of [
    value => { Object.defineProperty(value.sourcePages[0],'expected',{enumerable:true,get(){reads++;return 'I';}}); },
    value => { Object.defineProperty(value.sourcePages[0].frame,'scale',{enumerable:true,get(){reads++;return 1;}}); },
    value => { Object.defineProperty(value.sourcePages,'0',{enumerable:true,get(){reads++;return null;}}); },
    value => { value.sourcePages.extra = 'hidden on JSON'; },
    value => { Object.defineProperty(value.document,'hidden',{value:true}); },
    value => { Object.defineProperty(value,'document',{enumerable:true,get(){reads++;return null;}}); }
  ]) { const value = fixture(); mutate(value); abstain(createPrivateReviewSnapshot(value)); }
  assert.equal(reads,0);
});

test('sidecar capture validates before replacement and does not retain caller references', () => {
  const value = fixture();
  const captured = capturePrivateSourcePages(value.sourcePages, value.document.pages);
  value.sourcePages[0].caseId = 'substitution';
  assert.equal(captured[0].caseId,'authored-physical-5');
  const bad = fixture(); bad.sourcePages[0].frame.height = 201;
  assert.throws(() => capturePrivateSourcePages(bad.sourcePages,bad.document.pages));
});

test('later page mismatch and oversized draft cannot silently remove cases or return a partial snapshot', () => {
  const value = fixture(), secondPage = structuredClone(value.document.pages[0]);
  secondPage.id='p2'; secondPage.fragmentIds=['p2-f0']; secondPage.regions[0].id='p2-r0'; secondPage.regions[0].fragmentIds=['p2-f0'];
  const secondSource=structuredClone(value.sourcePages[0]);
  secondSource.pageId='p2'; secondSource.physicalPage=1; secondSource.caseId='authored-physical-1'; secondSource.nativeFragmentIds=['p2-f0'];
  value.document.pages.push(secondPage); value.sourcePages.push(secondSource);
  assert.equal(createPrivateReviewSnapshot(value).status,'DRAFT');
  value.sourcePages[1].physicalPage=5;
  abstain(createPrivateReviewSnapshot(value));
  const huge=fixture(); huge.document.pages[0].regions[0].text='a'.repeat(262145);
  abstain(createPrivateReviewSnapshot(huge));
});
