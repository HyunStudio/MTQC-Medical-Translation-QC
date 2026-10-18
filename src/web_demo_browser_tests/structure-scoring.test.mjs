import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreStructure } from '../web_demo_evaluation/structure-scoring.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { summarizeExtractedPage, resolveManifestSourcePath, assertSha256, validateTruthCases,
  preflightReplayInputs, validateTruthLock } from './structure-replay.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { projectAutomaticObservations, scoreCandidateArms,
  aggregateCandidateReports } from '../web_demo_evaluation/structure-projection.mjs';

function item(id, kind, expected) { return { id, kind, expected }; }
function observation(id, value, status = 'proposed') { return { id, value, status }; }

test('all glyphs present cannot hide a wrong table header/value association', () => {
  const truth = { caseId: 'medical-table-p4', items: [
    item('fragments', 'fragment-coverage', { fragmentIds: ['method', 'dose', 'unit'] }),
    item('dose-binding', 'table-binding', { valueCellId: 'dose', headerCellIds: ['unit'], row: 2, column: 1, text: '2.5 mg' })
  ] };
  const proposal = [
    observation('fragments', { fragmentIds: ['method', 'dose', 'unit'] }),
    observation('dose-binding', { valueCellId: 'dose', headerCellIds: ['method'], row: 2, column: 1, text: '2.5 mg' })
  ];
  const result = scoreStructure({ truth, proposal, reviewed: proposal });
  assert.deepEqual(result.denominators, { 'fragment-coverage': 1, 'table-binding': 1 });
  assert.equal(result.automatic.correct, 1);
  assert.equal(result.automatic.total, 2);
  assert.deepEqual(result.failures.automatic.map(failure => failure.id), ['dose-binding']);
});

test('formula grouping and duplicate fragment ownership both fail', () => {
  const truth = { caseId: 'formula-p2', items: [
    item('glyphs', 'fragment-coverage', { fragmentIds: ['D', '95', '%'] }),
    item('formula', 'formula-grouping', { text: 'D₉₅%', groups: [['D', '95', '%']] })
  ] };
  const result = scoreStructure({ truth, proposal: [
    observation('glyphs', { fragmentIds: ['D', '95', '95', '%'] }),
    observation('formula', { text: 'D 95%', groups: [['D'], ['95', '%']] })
  ], reviewed: [] });
  assert.equal(result.automatic.correct, 0);
  assert.equal(result.automatic.total, 2);
  assert.equal(result.failures.automatic.length, 2);
});

test('locked PDF fragment count expands to an exact identity set', () => {
  const truth = { caseId: 'fragment-count', items: [item('coverage', 'fragment-coverage', { fragmentCount: 3 })] };
  const good = scoreStructure({ truth, proposal: [observation('coverage', { fragmentIds: ['p1-f2', 'p1-f0', 'p1-f1'] })], reviewed: [] });
  assert.equal(good.automatic.correct, 1);
  const substituted = scoreStructure({ truth, proposal: [observation('coverage', { fragmentIds: ['p1-f0', 'p1-f1', 'p1-foreign'] })], reviewed: [] });
  assert.equal(substituted.automatic.correct, 0);
});

test('OCR-missed figure label remains in the frozen denominator', () => {
  const truth = { caseId: 'figure-p1', items: [
    item('artery-label', 'figure-label', { figureId: 'figure-1', text: 'Middle cerebral artery' }),
    item('caption', 'caption-link', { captionId: 'caption-1', figureId: 'figure-1' })
  ] };
  const result = scoreStructure({ truth, proposal: [
    observation('caption', { captionId: 'caption-1', figureId: 'figure-1' })
  ], reviewed: [] });
  assert.equal(result.denominators['figure-label'], 1);
  assert.equal(result.automatic.total, 2);
  assert.deepEqual(result.failures.automatic.map(failure => failure.id), ['artery-label']);
});

test('unresolved content does not pass automatically; explicit uncertainty detection can', () => {
  const truth = { caseId: 'mixed-p3', items: [
    item('raster-label', 'figure-label', { figureId: 'figure-2', text: 'Hippocampus' }),
    item('raster-warning', 'unresolved-zone', { regionId: 'figure-2', flagged: true })
  ] };
  const result = scoreStructure({ truth, proposal: [
    observation('raster-label', { figureId: 'figure-2', text: 'Hippocampus' }, 'unresolved'),
    observation('raster-warning', { regionId: 'figure-2', flagged: true })
  ], reviewed: [] });
  assert.equal(result.automatic.correct, 1);
  assert.deepEqual(result.failures.automatic.map(failure => failure.id), ['raster-label']);
});

test('manual correction improves only the reviewed arm and wrong verified content is a silent error', () => {
  const truth = { caseId: 'columns-p5', items: [
    item('order', 'reading-edge', { from: 'left-last', to: 'right-first' }),
    item('label', 'figure-label', { figureId: 'f1', text: 'Thalamus' })
  ] };
  const result = scoreStructure({ truth,
    proposal: [observation('order', { from: 'right-first', to: 'left-last' })],
    reviewed: [
      observation('order', { from: 'left-last', to: 'right-first' }, 'verified'),
      observation('label', { figureId: 'f1', text: 'Thalamus' }, 'verified')
    ] });
  assert.equal(result.automatic.correct, 0);
  assert.equal(result.reviewed.correct, 2);
  assert.equal(result.reviewed.silentErrors, 0);
  const wrong = scoreStructure({ truth, proposal: [], reviewed: [
    observation('order', { from: 'right-first', to: 'left-last' }, 'verified')
  ] });
  assert.equal(wrong.reviewed.silentErrors, 1);
});

test('duplicate truth IDs or observations are rejected instead of shrinking denominators', () => {
  const duplicated = { caseId: 'bad', items: [item('a', 'reading-edge', { from: 'x', to: 'y' }), item('a', 'reading-edge', { from: 'x', to: 'z' })] };
  assert.throws(() => scoreStructure({ truth: duplicated, proposal: [], reviewed: [] }), /duplicate/i);
  const valid = { caseId: 'ok', items: [item('a', 'reading-edge', { from: 'x', to: 'y' })] };
  assert.throws(() => scoreStructure({ truth: valid, proposal: [observation('a', {}), observation('a', {})], reviewed: [] }), /duplicate/i);
});

test('automatic arm rejects verified observations to prevent reviewer leakage', () => {
  const truth = { caseId: 'leakage', items: [item('a', 'reading-edge', { from: 'x', to: 'y' })] };
  assert.throws(() => scoreStructure({ truth,
    proposal: [observation('a', { from: 'x', to: 'y' }, 'verified')], reviewed: [] }), /automatic|verified/i);
});

test('replay preserves native and flat baselines separately from unverified graph', () => {
  const result = summarizeExtractedPage({ pageIndex: 0, width: 400, height: 500,
    fragments: [
      { text: 'Left first.', x: 10, y: 20, width: 100, height: 10 },
      { text: 'Right first.', x: 230, y: 20, width: 110, height: 10 }
    ], hasImages: true, ocrText: '' });
  assert.equal(result.native.fragmentIds.length, 2);
  assert.equal(result.flat.fragmentCount, 2);
  assert.deepEqual(result.graph.regions.flatMap(region => region.fragmentIds).sort(), ['p1-f0', 'p1-f1']);
  assert(result.graph.regions.every(region => region.status !== 'verified'));
  assert(result.graph.issues.some(issue => issue.code === 'raster-content-unassessed'));
});

test('replay source paths are anchored to the locked manifest directory', () => {
  const manifest = path.resolve('local', 'manifest.json');
  assert.equal(resolveManifestSourcePath(manifest, 'article.pdf'), path.resolve('local', 'article.pdf'));
  assert.throws(() => resolveManifestSourcePath(manifest, '..\\outside.pdf'), /outside manifest/i);
  assert.throws(() => resolveManifestSourcePath(manifest, path.resolve('absolute.pdf')), /outside manifest/i);
  for (const outside of ['../outside.pdf', '..\\nested/../../outside.pdf', 'C:outside.pdf', 'C:/outside.pdf', 'C:\\outside.pdf', '\\\\server\\share\\outside.pdf'])
    assert.throws(() => resolveManifestSourcePath(manifest, outside), /outside manifest/i);
  assert.equal(resolveManifestSourcePath(manifest, 'nested\\article.pdf'), path.resolve('local', 'nested', 'article.pdf'));
});

test('replay refuses changed visual truth or source-page renders', () => {
  const bytes = Buffer.from('frozen visual labels');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(assertSha256(bytes, digest, 'truth'), digest);
  assert.throws(() => assertSha256(Buffer.from('changed'), digest, 'truth'), /truth.*hash/i);
});

test('replay refuses a truth file missing any locked physical page', () => {
  const cases = [{ caseId: 'paper-p1' }, { caseId: 'paper-p2' }];
  assert.throws(() => validateTruthCases(cases, [{ caseId: 'paper-p1', items: [{ id: 'coverage' }] }]), /missing/i);
});

test('replay refuses truth annotations bound to a different source page', () => {
  const cases = [{ caseId: 'paper-p1', sourceSha256: 'a'.repeat(64),
    pageImageSha256: 'b'.repeat(64), page: 1, fragmentCount: 3 }];
  const truth = { caseId: 'paper-p1', sourceSha256: 'a'.repeat(64),
    pageImageSha256: 'b'.repeat(64), physicalPage: 1,
    items: [{ id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount: 3 } }] };
  assert.doesNotThrow(() => validateTruthCases(cases, [truth]));
  assert.throws(() => validateTruthCases(cases, [{ ...truth, physicalPage: 2 }]), /physical page/i);
  assert.throws(() => validateTruthCases(cases, [{ ...truth, pageImageSha256: 'c'.repeat(64) }]), /page image/i);
  assert.throws(() => validateTruthCases(cases, [{ ...truth,
    items: [{ id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount: 2 } }] }]), /fragment count/i);
});

test('replay refuses coverage-only truth on a page selected for visible structure', () => {
  const cases = [{ caseId: 'figure-p3', requiredKinds: ['figure-label', 'caption-link'] }];
  const coverageOnly = { caseId: 'figure-p3', items: [
    { id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount: 20 } }
  ] };
  assert.throws(() => validateTruthCases(cases, [coverageOnly]), /figure-label/i);
  assert.doesNotThrow(() => validateTruthCases(cases, [{ ...coverageOnly, items: [
    ...coverageOnly.items,
    { id: 'label', kind: 'figure-label', expected: { figureId: 'f1', text: 'Thalamus' } },
    { id: 'caption', kind: 'caption-link', expected: { figureId: 'f1', captionId: 'c1' } }
  ] }]));
});

test('replay preflights every source and render before generating any candidate arm', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mtqc-replay-preflight-'));
  try {
    const manifest = path.join(dir, 'manifest.json');
    const first = Buffer.from('first source');
    const second = Buffer.from('second source');
    const image = Buffer.from('page render');
    await writeFile(path.join(dir, 'first.pdf'), first);
    await writeFile(path.join(dir, 'first-page-1.png'), image);
    await writeFile(path.join(dir, 'second.pdf'), second);
    await writeFile(path.join(dir, 'second-page-1.png'), Buffer.from('tampered render'));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const cases = [first, second].map((bytes, index) => ({ caseId: `case-${index}`,
      sourcePath: index ? 'second.pdf' : 'first.pdf', sourceSha256: hash(bytes),
      page: 1, pageImageSha256: hash(image) }));
    await assert.rejects(preflightReplayInputs(manifest, cases), /case-1 visual page hash/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a hashed but unfinished visual annotation cannot unlock replay', () => {
  const completeCase = { caseId: 'page-1', items: [{ id: 'coverage' }],
    visualReview: { pass1Complete: true, pass2Complete: true } };
  assert.throws(() => validateTruthLock({ status: 'draft' },
    { status: 'locked', cases: [completeCase] }), /manifest.*locked/i);
  assert.throws(() => validateTruthLock({ status: 'locked' },
    { status: 'draft', cases: [completeCase] }), /truth.*locked/i);
  assert.throws(() => validateTruthLock({ status: 'locked' },
    { status: 'locked', cases: [{ ...completeCase, visualReview: { pass1Complete: true } }] }), /pass 2/i);
  assert.doesNotThrow(() => validateTruthLock({ status: 'locked' },
    { status: 'locked', cases: [completeCase] }));
});

test('automatic projector credits only visible fragment coverage and adjacent reading anchors', () => {
  const truth = { caseId: 'synthetic', items: [
    item('coverage', 'fragment-coverage', { fragmentCount: 2 }),
    item('edge', 'reading-edge', { from: 'left end', to: 'right start' }),
    item('table', 'table-binding', { valueCellId: 'v', headerCellIds: ['h'], row: 1, column: 1, text: '2 mg' })
  ] };
  const candidate = summarizeExtractedPage({ pageIndex: 0, width: 500, height: 300,
    fragments: [
      { text: 'left end', x: 20, y: 20, width: 90, height: 12 },
      { text: 'right start', x: 270, y: 20, width: 100, height: 12 }
    ], hasImages: false });
  const projected = projectAutomaticObservations({ truth, arm: 'graph', candidate });
  const result = scoreStructure({ truth, proposal: projected, reviewed: [] });
  assert.equal(result.automatic.correct, 2);
  assert.deepEqual(result.failures.automatic.map(failure => failure.id), ['table']);
});

test('automatic projector does not turn nonadjacent or reversed anchors into a reading success', () => {
  const truth = { caseId: 'synthetic', items: [item('edge', 'reading-edge', { from: 'A', to: 'B' })] };
  const candidate = { native: { text: 'A unrelated content B', fragmentIds: [] },
    flat: { text: 'B\nA', lines: [] }, graph: { regions: [], issues: [] } };
  assert.deepEqual(projectAutomaticObservations({ truth, arm: 'native', candidate }), []);
  assert.deepEqual(projectAutomaticObservations({ truth, arm: 'flat', candidate }), []);
});

test('graph page-raster warning earns only page-level detection credit, never figure-label credit', () => {
  const truth = { caseId: 'synthetic', items: [
    item('warning', 'unresolved-zone', { regionId: 'page', flagged: true }),
    item('label', 'figure-label', { figureId: 'figure-1', text: 'Thalamus' })
  ] };
  const candidate = summarizeExtractedPage({ pageIndex: 0, width: 500, height: 300,
    fragments: [{ text: 'Fig. 1', x: 20, y: 250, width: 50, height: 12 }], hasImages: true });
  const projected = projectAutomaticObservations({ truth, arm: 'graph', candidate });
  const result = scoreStructure({ truth, proposal: projected, reviewed: [] });
  assert.equal(result.automatic.correct, 1);
  assert.deepEqual(result.failures.automatic.map(failure => failure.id), ['label']);
});

test('page-level raster warning cannot claim that a particular figure was located', () => {
  const truth = { caseId: 'synthetic', items: [
    item('figure-zone', 'unresolved-zone', { regionId: 'figure-1', flagged: true })
  ] };
  const candidate = summarizeExtractedPage({ pageIndex: 0, width: 300, height: 200,
    fragments: [], hasImages: true });
  assert.deepEqual(projectAutomaticObservations({ truth, arm: 'graph', candidate }), []);
});

test('one page-level raster warning cannot claim multiple distinct image zones', () => {
  const truth = { caseId: 'synthetic', items: [
    item('zone-a', 'unresolved-zone', { regionId: 'figure-a', flagged: true }),
    item('zone-b', 'unresolved-zone', { regionId: 'figure-b', flagged: true })
  ] };
  const candidate = summarizeExtractedPage({ pageIndex: 0, width: 300, height: 200,
    fragments: [], hasImages: true });
  assert.deepEqual(projectAutomaticObservations({ truth, arm: 'graph', candidate }), []);
});

test('candidate-arm report keeps native, flat, and graph scores separate', () => {
  const truth = { caseId: 'synthetic', items: [
    item('coverage', 'fragment-coverage', { fragmentCount: 2 }),
    item('edge', 'reading-edge', { from: 'left end', to: 'right start' })
  ] };
  const candidate = summarizeExtractedPage({ pageIndex: 0, width: 500, height: 300,
    fragments: [
      { text: 'left end', x: 20, y: 20, width: 90, height: 12 },
      { text: 'right start', x: 270, y: 20, width: 100, height: 12 }
    ], hasImages: false });
  candidate.flat.text = 'right start\nleft end';
  const report = scoreCandidateArms({ truth, candidate });
  assert.equal(report.arms.flat.correct, 1);
  assert.equal(report.arms.graph.correct, 2);
  assert.equal(report.arms.native.correct, 2);
  assert.equal(Object.hasOwn(report, 'reviewed'), false);
});

test('corpus aggregation retains every page denominator and named failure', () => {
  const report = (caseId, correct) => ({ caseId, denominators: { 'reading-edge': 1 },
    arms: Object.fromEntries(['native', 'flat', 'graph'].map(arm => [arm, {
      correct, total: 1, byKind: { 'reading-edge': { correct, total: 1 } },
      failures: correct ? [] : [{ id: 'edge', kind: 'reading-edge', reason: 'missing' }]
    }])) });
  const summary = aggregateCandidateReports([report('p1', 1), report('p2', 0)]);
  assert.deepEqual(summary.arms.graph.byKind['reading-edge'], { correct: 1, total: 2 });
  assert.deepEqual(summary.arms.graph.failures, [
    { caseId: 'p2', id: 'edge', kind: 'reading-edge', reason: 'missing' }
  ]);
  assert.throws(() => aggregateCandidateReports([report('p1', 1), report('p1', 0)]), /duplicate/i);
});

test('locked synthetic replay writes all three automatic arms and a code-hashed summary', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mtqc-locked-replay-'));
  try {
    const pdfBytes = await readFile(new URL('../web_demo/fixtures/assets/Mueller_Figure1_Translation_Comparison_DRAFT.pdf', import.meta.url));
    const pdfjs = await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true });
    let fragmentCount;
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      fragmentCount = (await page.getTextContent()).items.filter(part => part.str?.trim()).length;
    } finally { await task.destroy().catch(() => {}); }
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const renderBytes = Buffer.from('test-only render placeholder');
    const truth = Buffer.from(JSON.stringify({ status: 'locked', cases: [{
      caseId: 'fixture-p1', sourceSha256: hash(pdfBytes), pageImageSha256: hash(renderBytes),
      physicalPage: 1, visualReview: { pass1Complete: true, pass2Complete: true },
      items: [{ id: 'coverage', kind: 'fragment-coverage', expected: { fragmentCount } }]
    }] }));
    const manifest = { status: 'locked', truthPath: 'truth.json', truthSha256: hash(truth),
      cases: [{ caseId: 'fixture-p1', sourcePath: 'fixture.pdf', sourceSha256: hash(pdfBytes),
        page: 1, pageImageSha256: hash(renderBytes), fragmentCount,
        requiredKinds: ['fragment-coverage'] }] };
    await writeFile(path.join(dir, 'fixture.pdf'), pdfBytes);
    await writeFile(path.join(dir, 'fixture-page-1.png'), renderBytes);
    await writeFile(path.join(dir, 'truth.json'), truth);
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const output = path.join(dir, 'candidate-output');
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./structure-replay.mjs', import.meta.url)),
      '--manifest', path.join(dir, 'manifest.json'), '--out', output]);
    const summary = JSON.parse(await readFile(path.join(output, 'summary.scores.json'), 'utf8'));
    assert.equal(summary.physicalPageCount, 1);
    assert.match(summary.candidateCodeSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(summary.arms), ['native', 'flat', 'graph']);
    assert.equal(summary.arms.graph.total, 1);
    assert.equal(summary.reviewedArmStatus, 'not-yet-scored');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
