import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const evaluator = await import('./evaluator.mjs').catch(() => ({}));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const caseRecord = { id: 'synthetic-ko-01', source: 'The artery measures 2.5 mm.', sourceSha256: hash('The artery measures 2.5 mm.'), targetLanguage: 'ko', author: 'HyunStudio', license: 'Original synthetic example' };
const draft = '동맥은 3.5 mm입니다.';
const baseRun = { runId: 'r1', caseId: caseRecord.id, targetLanguage: 'ko', draft,
  draftSha256: hash(draft),
  baseline: { draftSha256: hash(draft), findings: [] },
  enhanced: { draftSha256: hash(draft), findings: [{ category: 'number', draftSpan: '3.5 mm', provenance: 'model' }] },
  latencyMs: 1200, promptTokens: 25, completionTokens: 10, estimatedCostUsd: null };
const seededGold = { runId: 'r1', caseId: caseRecord.id, seed: { category: 'number', draftSpan: '3.5 mm' }, adjudicatedCleanCategories: [] };

test('evaluation module exports the paired scorer', () => {
  assert.equal(typeof evaluator.evaluateRuns, 'function');
});

test('two arms must consume the exact same saved draft', () => {
  assert.throws(() => evaluator.evaluateRuns([caseRecord], [{ ...baseRun, baseline: { ...baseRun.baseline, draftSha256: '0'.repeat(64) } }], [seededGold]), /same draft|hash/i);
});

test('correct seeded category and span count as detection, not generic warning', () => {
  const report = evaluator.evaluateRuns([caseRecord], [baseRun], [seededGold]);
  assert.equal(report.baseline.truePositive, 0);
  assert.equal(report.baseline.falseNegative, 1);
  assert.equal(report.enhanced.truePositive, 1);
  assert.equal(report.enhanced.falseNegative, 0);
  assert.deepEqual(report.perCategory.number, { seeded: 1, baselineDetected: 0, enhancedDetected: 1 });
  const generic = { ...baseRun, enhanced: { ...baseRun.enhanced, findings: [{ category: 'number', provenance: 'model' }] } };
  assert.equal(evaluator.evaluateRuns([caseRecord], [generic], [seededGold]).enhanced.truePositive, 0);
});

test('ungrounded null evidence is retained as warning but never scores as detection', () => {
  const ungrounded = { ...baseRun, enhanced: { ...baseRun.enhanced,
    findings: [{ category: 'number', draftSpan: null, provenance: 'model' }] } };
  const report = evaluator.evaluateRuns([caseRecord], [ungrounded], [seededGold]);
  assert.equal(report.enhanced.warningVolume, 1);
  assert.equal(report.enhanced.truePositive, 0);
});

test('specific substring evidence can localize a seeded affected span', () => {
  const overlapping = { ...baseRun, enhanced: { ...baseRun.enhanced,
    findings: [{ category: 'number', draftSpan: '3.5', provenance: 'rule' }] } };
  assert.equal(evaluator.evaluateRuns([caseRecord], [overlapping], [seededGold]).enhanced.truePositive, 1);
  const unrelated = { ...baseRun, enhanced: { ...baseRun.enhanced,
    findings: [{ category: 'number', draftSpan: '5 mm', provenance: 'rule' }] } };
  assert.equal(evaluator.evaluateRuns([caseRecord], [unrelated], [seededGold]).enhanced.truePositive, 0);
});

test('unseeded warnings are volume, not unadjudicated false positives', () => {
  const control = { ...baseRun, runId: 'control', enhanced: { ...baseRun.enhanced, findings: [{ category: 'terminology', draftSpan: '동맥', provenance: 'model' }] } };
  const gold = { runId: 'control', caseId: caseRecord.id, seed: null, adjudicatedCleanCategories: [] };
  const report = evaluator.evaluateRuns([caseRecord], [control], [gold]);
  assert.equal(report.enhanced.warningVolume, 1);
  assert.equal(report.enhanced.falsePositive, 0);
  assert.equal(report.enhanced.precision, null);
  assert.equal(report.enhanced.precisionStatus, 'not measured');
});

test('adjudicated clean category permits false-positive accounting', () => {
  const control = { ...baseRun, runId: 'control', enhanced: { ...baseRun.enhanced, findings: [{ category: 'number', draftSpan: '3.5 mm', provenance: 'rule' }] } };
  const gold = { runId: 'control', caseId: caseRecord.id, seed: null, adjudicatedCleanCategories: ['number'] };
  const report = evaluator.evaluateRuns([caseRecord], [control], [gold]);
  assert.equal(report.enhanced.falsePositive, 1);
  assert.equal(report.enhanced.precision, 0);
});

test('missing case or gold and duplicate run IDs fail closed', () => {
  assert.throws(() => evaluator.evaluateRuns([], [baseRun], [seededGold]), /case/i);
  assert.throws(() => evaluator.evaluateRuns([caseRecord], [baseRun], []), /gold/i);
  assert.throws(() => evaluator.evaluateRuns([caseRecord], [baseRun, baseRun], [seededGold]), /duplicate/i);
});

test('source manifest rejects changed text after hash freeze', () => {
  assert.throws(() => evaluator.evaluateRuns([{ ...caseRecord, source: 'The artery measures 9.5 mm.' }], [baseRun], [seededGold]), /source.*hash/i);
});

test('all published synthetic source hashes match their text', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../docs/web-demo/evaluation/cases-v1.json', import.meta.url), 'utf8'));
  assert.equal(manifest.cases.length, 3);
  for (const specimen of manifest.cases) assert.equal(hash(specimen.source), specimen.sourceSha256, specimen.id);
});
