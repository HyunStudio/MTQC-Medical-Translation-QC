import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './evaluator.mjs';

const mutations = {
  'synthetic-ko-01': { before: '근위부', after: '원위부', category: 'direction' },
  'synthetic-es-01': { before: '2 mg', after: '3 mg', category: 'number' },
  'synthetic-ar-01': { before: '1.8', after: '8.1', category: 'number' }
};

export function makeVariants(draftCapture) {
  if (!Array.isArray(draftCapture?.drafts) || draftCapture.drafts.length === 0)
    throw new Error('Direct draft cases missing');
  const variants = [];
  const gold = [];
  const seen = new Set();
  for (const item of draftCapture.drafts) {
    const mutation = mutations[item.caseId];
    if (!mutation || seen.has(item.caseId)) throw new Error('Unexpected or duplicate case');
    seen.add(item.caseId);
    if (typeof item.draft !== 'string' || sha256(item.draft) !== item.draftSha256)
      throw new Error('Direct draft hash mismatch');
    if (item.draft.split(mutation.before).length !== 2)
      throw new Error(`Expected exactly one mutation span for ${item.caseId}`);
    const changed = item.draft.replace(mutation.before, mutation.after);
    variants.push({ runId: `${item.caseId}-control`, caseId: item.caseId,
      draft: item.draft, draftSha256: item.draftSha256 });
    variants.push({ runId: `${item.caseId}-seeded`, caseId: item.caseId,
      draft: changed, draftSha256: sha256(changed) });
    gold.push({ runId: `${item.caseId}-control`, caseId: item.caseId,
      seed: null, adjudicatedCleanCategories: ['number'] });
    gold.push({ runId: `${item.caseId}-seeded`, caseId: item.caseId,
      seed: { category: mutation.category, draftSpan: mutation.after },
      adjudicatedCleanCategories: mutation.category === 'direction' ? ['number'] : [] });
  }
  return { variants, gold };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 5) {
    console.error('Usage: node make_variants.mjs direct-drafts.json variants.json gold.json');
    process.exit(2);
  }
  const [, , draftsPath, variantsPath, goldPath] = process.argv;
  const capture = JSON.parse(await readFile(draftsPath, 'utf8'));
  const { variants, gold } = makeVariants(capture);
  const runSet = 'mtqc-controlled-direct-drafts-2026-10-01-v1';
  await writeFile(variantsPath, JSON.stringify({ runSet, captureKind: capture.captureKind,
    model: 'nvidia/Nemotron-3_5-Lightning', variants }, null, 2) + '\n', { flag: 'wx' });
  await writeFile(goldPath, JSON.stringify({ runSet, labelPolicy: 'Controlled single-span changes; gold is never sent to the model',
    gold }, null, 2) + '\n', { flag: 'wx' });
  console.log(`${variants.length} frozen variants and ${gold.length} separate labels written`);
}
