import test from 'node:test';
import assert from 'node:assert/strict';
import * as replay from './structure-replay.mjs';
import { scoreCandidateArms, aggregateCandidateReports } from '../web_demo_evaluation/structure-projection.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function authored(fragmentCount = 2) {
  const identity = { caseId: 'authored-p1', sourceSha256: 'a'.repeat(64),
    pageImageSha256: 'b'.repeat(64), physicalPage: 1 };
  const truth = { ...identity, visualReview: { pass1Complete: true, pass2Complete: true }, items: [
    { id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount } },
    { id: 'reading', kind: 'reading-edge', expected: { from: 'Authored left', to: 'Authored right' } },
    { id: 'table', kind: 'table-binding', expected: { valueCellId: 'value', headerCellIds: ['header'], row: 1, column: 0, text: '2 mg' } },
    { id: 'formula', kind: 'formula-grouping', expected: { text: 'D95', groups: ['D', '95'] } }
  ] };
  const region = (id, type, text, extra = {}) => ({ id, type, text, status: 'verified', fragmentIds: [], ...extra });
  const artifact = { ...identity, pageId: 'p1', document: { schemaVersion: 1, pages: [{ id: 'p1',
    regions: [region('a', 'paragraph', 'Authored left', { fragmentIds: Array.from({ length: fragmentCount }, (_, n) => `p1-f${n}`) }),
      region('b', 'paragraph', 'Authored right'), region('t', 'table', '', { table: { reviewed: true, cells: [
        { id: 'h', role: 'header', row: 0, column: 0, text: 'Dose', headerCellIds: [] },
        { id: 'v', role: 'value', row: 1, column: 0, text: '3 mg', headerCellIds: ['h'] }
      ] } }), region('eq', 'equation', 'D95', { equationReview: { sourceChecked: true } })],
    edges: [{ id: 'read', type: 'reading-next', from: 'a', to: 'b', status: 'verified' }], issues: []
  }] }, bindings: [
    { id: 'coverage', reviewed: true }, { id: 'reading', reviewed: true, edgeId: 'read' },
    { id: 'table', reviewed: true, regionId: 't', cellId: 'v', canonicalCellIds: [
      { id: 'v', canonicalId: 'value' }, { id: 'h', canonicalId: 'header' }] },
    { id: 'formula', reviewed: true, regionId: 'eq' }
  ] };
  return { truth, artifact };
}

test('reviewed report keeps manual gains, wrong verified values and unresolved items separate from automatic arms', () => {
  const { truth, artifact } = authored();
  const candidate = { native: { fragmentIds: ['p1-f0', 'p1-f1'], text: 'Different extraction' },
    flat: { lines: [], text: 'Different extraction' }, graph: { regions: [], issues: [] } };
  const before = scoreCandidateArms({ truth, candidate });
  const report = scoreCandidateArms({ truth, candidate, reviewedArtifact: artifact });
  assert.deepEqual(report.arms, before.arms);
  assert.equal(report.reviewed.correct, 2);
  assert.equal(report.reviewed.total, 4);
  assert.equal(report.reviewed.silentErrors, 1);
  assert.deepEqual(report.reviewed.failures.map(value => [value.id, value.reason]), [
    ['table', 'mismatch'], ['formula', 'unresolved']
  ]);
  const summary = aggregateCandidateReports([report]);
  assert.equal(summary.reviewed.silentErrors, 1);
  assert.equal(summary.reviewed.total, 4);
  assert.equal(summary.reviewed.failures[0].caseId, truth.caseId);
});

test('corpus aggregation refuses a partial reviewed arm instead of silently dropping pages', () => {
  const { truth, artifact } = authored();
  const candidate = { native: { fragmentIds: [], text: '' }, flat: { lines: [], text: '' }, graph: { regions: [], issues: [] } };
  const withReview = scoreCandidateArms({ truth, candidate, reviewedArtifact: artifact });
  const withoutReview = scoreCandidateArms({ truth: { ...truth, caseId: 'other' }, candidate });
  assert.throws(() => aggregateCandidateReports([withReview, withoutReview]), /reviewed.*all|partial reviewed/i);
});

test('reviewed aggregation cannot discard failed kinds while automatic denominators retain them', () => {
  const { truth, artifact } = authored();
  const candidate = { native: { fragmentIds: [], text: '' }, flat: { lines: [], text: '' }, graph: { regions: [], issues: [] } };
  const report = scoreCandidateArms({ truth, candidate, reviewedArtifact: artifact });
  for (const kind of ['table-binding', 'formula-grouping']) {
    delete report.denominators[kind]; delete report.reviewed.byKind[kind];
  }
  report.reviewed.total = 2; report.reviewed.failures = []; report.reviewed.silentErrors = 0;
  assert.equal(report.arms.native.total, 4);
  assert.throws(() => aggregateCandidateReports([report]), /denominator|candidate score/i);
});

test('reviewed bundle requires exact case set, truth lock hash and unambiguous source identities', () => {
  assert.equal(typeof replay.validateReviewedCases, 'function');
  const { truth, artifact } = authored();
  const bundle = { schemaVersion: 1, truthSha256: 'c'.repeat(64), cases: [artifact] };
  assert.doesNotThrow(() => replay.validateReviewedCases(bundle, [truth], 'c'.repeat(64)));
  for (const mutate of [
    value => { value.truthSha256 = 'd'.repeat(64); },
    value => { value.cases = []; },
    value => { value.cases.push(structuredClone(value.cases[0])); },
    value => { value.cases[0].caseId = 'extra'; },
    value => { value.cases[0].physicalPage = 2; }
  ]) {
    const bad = structuredClone(bundle); mutate(bad);
    assert.throws(() => replay.validateReviewedCases(bad, [truth], 'c'.repeat(64)), /reviewed|source identity/i);
  }
});

test('reviewed preflight rejects malformed later checklist before any candidate replay', () => {
  const { truth, artifact } = authored();
  const secondTruth = structuredClone(truth); secondTruth.caseId = 'authored-p2';
  delete secondTruth.items[0].expected;
  const secondArtifact = structuredClone(artifact); secondArtifact.caseId = secondTruth.caseId;
  const bundle = { schemaVersion: 1, truthSha256: 'c'.repeat(64), cases: [artifact, secondArtifact] };
  assert.throws(() => replay.validateReviewedCases(bundle, [truth, secondTruth], 'c'.repeat(64)), /checklist/i);
});

test('locked authored CLI replay scores a hashed reviewed bundle, and bad reviewed inputs emit no candidate files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mtqc-reviewed-replay-'));
  try {
    const pdfBytes = await readFile(new URL('../web_demo/fixtures/assets/Mueller_Figure1_Translation_Comparison_DRAFT.pdf', import.meta.url));
    const pdfjs = await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true });
    let fragmentCount;
    try { fragmentCount = (await (await (await task.promise).getPage(1)).getTextContent()).items.filter(value => value.str?.trim()).length; }
    finally { await task.destroy().catch(() => {}); }
    const { truth, artifact } = authored(fragmentCount);
    const imageBytes = Buffer.from('authored test render placeholder, not human truth');
    for (const value of [truth, artifact]) {
      value.sourceSha256 = hash(pdfBytes); value.pageImageSha256 = hash(imageBytes);
    }
    const truthBytes = Buffer.from(JSON.stringify({ status: 'locked', cases: [truth] }));
    const reviewedBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, truthSha256: hash(truthBytes), cases: [artifact] }));
    const manifest = { status: 'locked', truthPath: 'truth.json', truthSha256: hash(truthBytes),
      reviewedPath: 'reviewed.json', reviewedSha256: hash(reviewedBytes), cases: [{ caseId: truth.caseId,
        sourcePath: 'fixture.pdf', sourceSha256: hash(pdfBytes), page: 1,
        pageImageSha256: hash(imageBytes), fragmentCount,
        requiredKinds: ['fragment-coverage', 'reading-edge', 'table-binding', 'formula-grouping'] }] };
    for (const [name, bytes] of [['fixture.pdf', pdfBytes], ['fixture-page-1.png', imageBytes],
      ['truth.json', truthBytes], ['reviewed.json', reviewedBytes], ['manifest.json', JSON.stringify(manifest)]])
      await writeFile(path.join(dir, name), bytes);
    const run = output => promisify(execFile)(process.execPath, [fileURLToPath(new URL('./structure-replay.mjs', import.meta.url)),
      '--manifest', path.join(dir, 'manifest.json'), '--out', output]);
    const output = path.join(dir, 'result'); await run(output);
    const summary = JSON.parse(await readFile(path.join(output, 'summary.scores.json'), 'utf8'));
    assert.deepEqual(Object.keys(summary.arms), ['native', 'flat', 'graph']);
    assert.equal(summary.reviewed.correct, 2); assert.equal(summary.reviewed.total, 4);
    assert.equal(summary.reviewed.silentErrors, 1);
    assert.equal(summary.reviewedArtifactSha256, hash(reviewedBytes));
    assert.equal(summary.reviewedArmStatus, 'scored-not-source-certified');
    const raw = JSON.parse(await readFile(path.join(output, `${truth.caseId}.raw.json`), 'utf8'));
    assert.deepEqual(raw.reviewedArtifact, artifact);
    for (const bad of [
      { ...manifest, reviewedSha256: 'e'.repeat(64) },
      { ...manifest, reviewedSha256: undefined },
      { ...manifest, reviewedPath: '../escape.json' }
    ]) {
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(bad));
      const badOutput = path.join(dir, 'must-not-exist');
      await assert.rejects(run(badOutput), /reviewed|outside manifest/i);
      await assert.rejects(access(badOutput));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
