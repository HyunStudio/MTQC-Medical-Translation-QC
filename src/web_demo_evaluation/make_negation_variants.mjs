import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './evaluator.mjs';

const mutations = {
  'synthetic-es-01': {
    before: 'No se registró una dosis de 20 mg.',
    after: 'Se registró una dosis de 20 mg.',
    affected: 'Se registró una dosis de 20 mg.'
  },
  'synthetic-ar-01': {
    before: 'لَا يَرَى خَثْرَةٌ قَرِيبَةٌ.',
    after: 'يَرَى خَثْرَةٌ قَرِيبَةٌ.',
    affected: 'يَرَى خَثْرَةٌ قَرِيبَةٌ.'
  }
};

export function makeNegationVariants(capture) {
  const drafts = capture?.drafts;
  if (!Array.isArray(drafts)) throw new Error('Direct drafts missing');
  const variants = [];
  const gold = [];
  for (const [caseId, mutation] of Object.entries(mutations)) {
    const item = drafts.find(draft => draft.caseId === caseId);
    if (!item || sha256(item.draft) !== item.draftSha256 ||
        item.draft.split(mutation.before).length !== 2)
      throw new Error(`Frozen negation span missing or altered for ${caseId}`);
    const changed = item.draft.replace(mutation.before, mutation.after);
    for (const [suffix, text] of [['control', item.draft], ['seeded', changed]]) {
      const runId = `${caseId}-${suffix}-negation-v2`;
      variants.push({ runId, caseId, draft: text, draftSha256: sha256(text) });
      gold.push({ runId, caseId,
        seed: suffix === 'seeded' ? { category: 'negation', draftSpan: mutation.affected } : null,
        adjudicatedCleanCategories: suffix === 'control' ? ['number', 'negation'] : ['number'] });
    }
  }
  return { variants, gold };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 5) {
    console.error('Usage: node make_negation_variants.mjs direct-drafts.json variants.json gold.json');
    process.exit(2);
  }
  const [, , draftsPath, variantsPath, goldPath] = process.argv;
  const capture = JSON.parse(await readFile(draftsPath, 'utf8'));
  const { variants, gold } = makeNegationVariants(capture);
  const runSet = 'mtqc-negation-development-retest-2026-10-01-v2';
  await writeFile(variantsPath, JSON.stringify({ runSet, captureKind: capture.captureKind,
    promptVersion: 'mtqc-critique-prompt-2026-10-01-v2', variants }, null, 2) + '\n', { flag: 'wx' });
  await writeFile(goldPath, JSON.stringify({ runSet,
    labelPolicy: 'Two controlled negation mutations on reused direct drafts; development retest, not independent holdout',
    gold }, null, 2) + '\n', { flag: 'wx' });
  console.log(`${variants.length} frozen v2 development variants and separate gold labels written`);
}
