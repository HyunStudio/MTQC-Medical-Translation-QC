import { createHash } from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

const categories = new Set(['number', 'unit', 'direction', 'negation', 'terminology', 'omission', 'other']);

function validCase(record) {
  return record && typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.source === 'string' && record.source.length > 0 &&
    typeof record.targetLanguage === 'string' && record.targetLanguage.length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 &&
    typeof record.license === 'string' && record.license.length > 0;
}

function validHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

function validateFindings(findings) {
  if (!Array.isArray(findings)) throw new Error('Findings must be an array');
  for (const item of findings) {
    if (!item || !categories.has(item.category) ||
        !['model', 'rule'].includes(item.provenance) ||
        (item.draftSpan !== undefined && item.draftSpan !== null && typeof item.draftSpan !== 'string'))
      throw new Error('Finding schema invalid');
  }
}

function overlapsAffectedSpan(found, affected) {
  return typeof found === 'string' && found.length > 0 &&
    (affected.startsWith(found) || (found.length <= 120 && found.includes(affected)));
}

export function evaluateRuns(cases, runs, gold) {
  if (!Array.isArray(cases) || !Array.isArray(runs) || !Array.isArray(gold) || runs.length === 0)
    throw new Error('Missing evaluation runs or denominators');
  const caseMap = new Map();
  for (const item of cases) {
    if (!validCase(item) || caseMap.has(item.id)) throw new Error('Invalid or duplicate case');
    if (!validHash(item.sourceSha256) || sha256(item.source) !== item.sourceSha256)
      throw new Error('Source hash does not match frozen case text');
    caseMap.set(item.id, item);
  }
  const goldMap = new Map();
  for (const item of gold) {
    if (!item || typeof item.runId !== 'string' || goldMap.has(item.runId) ||
        !Array.isArray(item.adjudicatedCleanCategories)) throw new Error('Invalid or duplicate gold label');
    if (item.seed !== null && (!item.seed || !categories.has(item.seed.category) ||
        typeof item.seed.draftSpan !== 'string' || item.seed.draftSpan.length === 0))
      throw new Error('Invalid seed label');
    for (const category of item.adjudicatedCleanCategories)
      if (!categories.has(category)) throw new Error('Invalid adjudicated category');
    goldMap.set(item.runId, item);
  }
  const runIds = new Set();
  const armResults = {
    baseline: { truePositive: 0, falseNegative: 0, falsePositive: 0, warningVolume: 0, unadjudicatedWarnings: 0 },
    enhanced: { truePositive: 0, falseNegative: 0, falsePositive: 0, warningVolume: 0, unadjudicatedWarnings: 0 }
  };
  let seededCount = 0;
  let controlCount = 0;
  let totalLatencyMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const languages = new Set();
  const perCategory = {};
  for (const run of runs) {
    if (!run || typeof run.runId !== 'string' || runIds.has(run.runId)) throw new Error('Duplicate or invalid run ID');
    runIds.add(run.runId);
    const specimen = caseMap.get(run.caseId);
    if (!specimen || specimen.targetLanguage !== run.targetLanguage) throw new Error('Missing or mismatched case');
    const label = goldMap.get(run.runId);
    if (!label || label.caseId !== run.caseId) throw new Error('Missing or mismatched gold label');
    if (typeof run.draft !== 'string' || !validHash(run.draftSha256) || sha256(run.draft) !== run.draftSha256 ||
        run.baseline?.draftSha256 !== run.draftSha256 || run.enhanced?.draftSha256 !== run.draftSha256)
      throw new Error('Both arms must use the same saved draft hash');
    if (label.seed && !run.draft.includes(label.seed.draftSpan)) throw new Error('Seed span missing from saved draft');
    if (!Number.isFinite(run.latencyMs) || run.latencyMs < 0 ||
        !Number.isInteger(run.promptTokens) || run.promptTokens < 0 ||
        !Number.isInteger(run.completionTokens) || run.completionTokens < 0)
      throw new Error('Missing or invalid latency/token denominator');
    totalLatencyMs += run.latencyMs;
    promptTokens += run.promptTokens;
    completionTokens += run.completionTokens;
    languages.add(run.targetLanguage);
    if (label.seed) {
      seededCount++;
      perCategory[label.seed.category] ??= { seeded: 0, baselineDetected: 0, enhancedDetected: 0 };
      perCategory[label.seed.category].seeded++;
    } else controlCount++;
    for (const arm of ['baseline', 'enhanced']) {
      const findings = run[arm]?.findings;
      validateFindings(findings);
      const score = armResults[arm];
      score.warningVolume += findings.length;
      let matched = false;
      for (const finding of findings) {
        const seedMatch = Boolean(label.seed && finding.category === label.seed.category &&
          overlapsAffectedSpan(finding.draftSpan, label.seed.draftSpan));
        if (seedMatch) matched = true;
        else if (label.adjudicatedCleanCategories.includes(finding.category)) score.falsePositive++;
        else score.unadjudicatedWarnings++;
      }
      if (label.seed) {
        if (matched) {
          score.truePositive++;
          perCategory[label.seed.category][`${arm}Detected`]++;
        }
        else score.falseNegative++;
      }
    }
  }
  if (goldMap.size !== runIds.size) throw new Error('Gold labels and runs have different denominators');
  for (const score of Object.values(armResults)) {
    score.recall = seededCount ? score.truePositive / seededCount : null;
    score.precision = score.unadjudicatedWarnings === 0 && score.truePositive + score.falsePositive > 0
      ? score.truePositive / (score.truePositive + score.falsePositive) : null;
    score.precisionStatus = score.precision === null ? 'not measured' : 'measured on adjudicated findings only';
  }
  return {
    sampleCount: runs.length, seededCount, controlCount, targetLanguages: [...languages].sort(),
    baseline: armResults.baseline, enhanced: armResults.enhanced, perCategory,
    totalLatencyMs, totalPromptTokens: promptTokens, totalCompletionTokens: completionTokens,
    estimatedCostUsd: 'not measured: no verified current price table or account bill',
    interpretation: 'Controlled review-error detection only; not clinical or full-document translation accuracy.'
  };
}
