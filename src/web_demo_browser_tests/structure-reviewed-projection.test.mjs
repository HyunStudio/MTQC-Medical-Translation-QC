import test from 'node:test';
import assert from 'node:assert/strict';
import * as projection from '../web_demo_evaluation/structure-projection.mjs';
import { scoreStructure } from '../web_demo_evaluation/structure-scoring.mjs';

function fixture() {
  const identity = { caseId: 'authored-p4', sourceSha256: 'a'.repeat(64),
    pageImageSha256: 'b'.repeat(64), physicalPage: 4 };
  const region = (id, type, text, extra = {}) => ({ id, type, text, status: 'verified',
    fragmentIds: [], ...extra });
  const page = { id: 'p1', fragmentIds: ['p1-f0', 'p1-f1'], regions: [
    region('a', 'paragraph', 'left end', { fragmentIds: ['p1-f0'] }),
    region('b', 'paragraph', 'right start', { fragmentIds: ['p1-f1'] }),
    region('table', 'table', '', { table: { reviewed: true, cells: [
      { id: 'h', role: 'header', text: 'Dose', row: 0, column: 0, headerCellIds: [] },
      { id: 'v', role: 'value', text: '2 mg', row: 1, column: 0, headerCellIds: ['h'] }
    ] } }),
    region('fig', 'figure', '', { figureReview: { sourceChecked: true,
      decision: 'labels-transcribed', labels: [{ id: 'label', text: 'Thalamus' }] } }),
    region('caption', 'caption', 'Fig. 1'),
    region('eq', 'equation', 'D95', { equationReview: { sourceChecked: true } })
  ], edges: [
    { id: 'read', type: 'reading-next', from: 'a', to: 'b', status: 'verified' },
    { id: 'cap', type: 'caption-of', from: 'caption', to: 'fig', status: 'verified' }
  ], issues: [{ code: 'label-unreadable', pageId: 'p1', regionId: 'fig' }] };
  const items = [
    ['coverage', 'fragment-coverage', { fragmentCount: 2 }],
    ['reading', 'reading-edge', { from: 'left end', to: 'right start' }],
    ['table', 'table-binding', { valueCellId: 'value', headerCellIds: ['header'], row: 1, column: 0, text: '2 mg' }],
    ['label', 'figure-label', { figureId: 'figure-1', text: 'Thalamus' }],
    ['caption', 'caption-link', { captionId: 'caption-1', figureId: 'figure-1' }],
    ['zone', 'unresolved-zone', { regionId: 'figure-1', flagged: true }],
    ['formula', 'formula-grouping', { text: 'D95', groups: ['D', '95'] }]
  ].map(([id, kind, expected]) => ({ id, kind, expected }));
  const bindings = [
    { id: 'coverage' }, { id: 'reading', edgeId: 'read' },
    { id: 'table', regionId: 'table', cellId: 'v', canonicalCellIds: [
      { id: 'v', canonicalId: 'value' }, { id: 'h', canonicalId: 'header' }] },
    { id: 'label', regionId: 'fig', labelId: 'label', canonicalRegionId: 'figure-1' },
    { id: 'caption', edgeId: 'cap', canonicalRegionIds: [
      { id: 'caption', canonicalId: 'caption-1' }, { id: 'fig', canonicalId: 'figure-1' }] },
    { id: 'zone', regionId: 'fig', canonicalRegionId: 'figure-1', issueCode: 'label-unreadable' },
    { id: 'formula', regionId: 'eq' }
  ].map(binding => ({ ...binding, reviewed: true }));
  return { truth: { ...identity, items }, artifact: { ...identity, pageId: 'p1',
    document: { schemaVersion: 1, pages: [page] }, bindings } };
}

test('reviewed mapping observes graph values without reading expected answers', () => {
  const { truth, artifact } = fixture();
  const before = structuredClone(artifact);
  const checklist = { ...truth, items: truth.items.map(({ id, kind }) => ({ id, kind,
    get expected() { throw new Error('Expected answer must not be read by projector'); } })) };
  assert.equal(typeof projection.projectReviewedObservations, 'function');
  const reviewed = projection.projectReviewedObservations({ truth: checklist, artifact });
  assert.deepEqual(artifact, before);
  const score = scoreStructure({ truth, proposal: [], reviewed });
  assert.equal(score.automatic.correct, 0);
  assert.equal(score.reviewed.correct, 6);
  assert.equal(score.reviewed.total, 7);
  assert.equal(score.reviewed.silentErrors, 0);
  assert.deepEqual(score.failures.reviewed, [{ id: 'formula', kind: 'formula-grouping', reason: 'unresolved' }]);
  assert.equal(reviewed.find(value => value.id === 'formula').reason, 'formula-grouping-not-represented');
});

test('verified wrong graph transcription and relationships remain silent errors', () => {
  const { truth, artifact } = fixture();
  const page = artifact.document.pages[0];
  page.regions.find(region => region.id === 'table').table.cells[1].text = '3 mg';
  page.edges[0].from = 'b'; page.edges[0].to = 'a';
  const score = scoreStructure({ truth, proposal: [],
    reviewed: projection.projectReviewedObservations({ truth, artifact }) });
  assert.equal(score.reviewed.silentErrors, 2);
  assert.deepEqual(score.failures.reviewed.filter(failure => failure.reason === 'mismatch').map(value => value.id), ['reading', 'table']);
});

test('source digest, image, physical page and case identity mismatches reject the artifact', () => {
  for (const [key, value] of Object.entries({ caseId: 'other', sourceSha256: 'c'.repeat(64),
    pageImageSha256: 'd'.repeat(64), physicalPage: 5 })) {
    const { truth, artifact } = fixture(); artifact[key] = value;
    assert.throws(() => projection.projectReviewedObservations({ truth, artifact }), /source identity/i);
  }
});

test('ambiguous graph or checklist bindings reject rather than select the first match', () => {
  for (const mutate of [
    artifact => artifact.bindings.push({ ...artifact.bindings[0] }),
    artifact => artifact.document.pages.push(structuredClone(artifact.document.pages[0])),
    artifact => artifact.document.pages[0].regions.push({ ...artifact.document.pages[0].regions[0] }),
    artifact => artifact.document.pages[0].edges.push({ ...artifact.document.pages[0].edges[0] }),
    artifact => artifact.bindings[2].canonicalCellIds.push({ id: 'other', canonicalId: 'header' })
  ]) {
    const { truth, artifact } = fixture(); mutate(artifact);
    assert.throws(() => projection.projectReviewedObservations({ truth, artifact }), /duplicate|ambiguous/i);
  }
});

test('missing bindings, string review flags and unverified endpoints receive no reviewed credit', () => {
  const { truth, artifact } = fixture();
  artifact.bindings = artifact.bindings.filter(binding => binding.id !== 'coverage');
  artifact.bindings.find(binding => binding.id === 'table').reviewed = 'true';
  artifact.document.pages[0].regions[0].status = 'proposed';
  artifact.document.pages[0].regions.find(region => region.id === 'fig').figureReview.sourceChecked = 'true';
  const reviewed = projection.projectReviewedObservations({ truth, artifact });
  for (const id of ['coverage', 'reading', 'table', 'label'])
    assert.equal(reviewed.find(value => value.id === id).status, 'unresolved');
});

test('coverage retains duplicate fragments and raster warning cannot stand for a figure issue', () => {
  const { truth, artifact } = fixture();
  artifact.document.pages[0].regions[0].fragmentIds.push('p1-f0');
  artifact.document.pages[0].issues = [{ code: 'label-unreadable', pageId: 'p1', regionId: null }];
  const reviewed = projection.projectReviewedObservations({ truth, artifact });
  const score = scoreStructure({ truth, proposal: [], reviewed });
  assert.equal(score.reviewed.silentErrors, 1);
  assert.equal(reviewed.find(value => value.id === 'zone').status, 'unresolved');
});

test('original page fragment inventory cannot hide a missing reviewed region fragment', () => {
  const { truth, artifact } = fixture();
  artifact.document.pages[0].regions[0].fragmentIds = [];
  const reviewed = projection.projectReviewedObservations({ truth, artifact });
  assert.equal(scoreStructure({ truth, proposal: [], reviewed }).reviewed.silentErrors, 1);
});

test('unmapped header and absent label are unresolved, never reconstructed from truth', () => {
  const { truth, artifact } = fixture();
  artifact.bindings[2].canonicalCellIds.pop();
  artifact.bindings.find(binding => binding.id === 'label').labelId = 'absent';
  const reviewed = projection.projectReviewedObservations({ truth, artifact });
  for (const id of ['table', 'label']) assert.equal(reviewed.find(value => value.id === id).status, 'unresolved');
});

test('repeated reading text and competing caption targets cannot earn an unambiguous relation', () => {
  const { truth, artifact } = fixture();
  const page = artifact.document.pages[0];
  page.regions.push({ ...page.regions[0], id: 'another-a', fragmentIds: [] });
  page.edges.push({ ...page.edges[1], id: 'another-cap', to: 'table' });
  const reviewed = projection.projectReviewedObservations({ truth, artifact });
  for (const id of ['reading', 'caption'])
    assert.equal(reviewed.find(value => value.id === id).status, 'unresolved');
});

test('canonical source entities cannot alias different graph objects across checklist items', () => {
  const { truth, artifact } = fixture();
  const page = artifact.document.pages[0];
  page.regions.push({ ...structuredClone(page.regions.find(region => region.id === 'fig')), id: 'other-fig' });
  page.edges.find(edge => edge.id === 'cap').to = 'other-fig';
  artifact.bindings.find(binding => binding.id === 'caption').canonicalRegionIds[1].id = 'other-fig';
  assert.throws(() => projection.projectReviewedObservations({ truth, artifact }), /ambiguous canonical/i);
});

test('one table cell cannot acquire different canonical identities between checklist bindings', () => {
  const { truth, artifact } = fixture();
  truth.items.push({ ...truth.items.find(item => item.id === 'table'), id: 'table-again' });
  const binding = structuredClone(artifact.bindings.find(value => value.id === 'table'));
  binding.id = 'table-again'; binding.canonicalCellIds[0].canonicalId = 'other-value';
  artifact.bindings.push(binding);
  assert.throws(() => projection.projectReviewedObservations({ truth, artifact }), /ambiguous canonical/i);
});

test('branched or cyclic reading relations remain unresolved even with one correct edge', () => {
  for (const extra of [
    { id: 'branch', type: 'reading-next', from: 'a', to: 'eq', status: 'verified' },
    { id: 'cycle', type: 'reading-next', from: 'b', to: 'a', status: 'verified' }
  ]) {
    const { truth, artifact } = fixture(); artifact.document.pages[0].edges.push(extra);
    const reviewed = projection.projectReviewedObservations({ truth, artifact });
    assert.equal(reviewed.find(value => value.id === 'reading').status, 'unresolved');
  }
});
