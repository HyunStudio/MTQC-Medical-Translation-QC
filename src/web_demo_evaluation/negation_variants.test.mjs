import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from './evaluator.mjs';
import { makeNegationVariants } from './make_negation_variants.mjs';

test('v2 negation mutations are one-span, hashed, and gold remains separate', () => {
  const es = 'Se registró una dosis de 2 mg. No se registró una dosis de 20 mg.';
  const ar = 'الوريد 1.8 مم. لَا يَرَى خَثْرَةٌ قَرِيبَةٌ.';
  const { variants, gold } = makeNegationVariants({ drafts: [
    { caseId: 'synthetic-es-01', draft: es, draftSha256: sha256(es) },
    { caseId: 'synthetic-ar-01', draft: ar, draftSha256: sha256(ar) }
  ] });
  assert.equal(variants.length, 4);
  assert.equal(gold.length, 4);
  assert.equal(variants.find(item => item.runId.includes('es-01-seeded')).draft,
    'Se registró una dosis de 2 mg. Se registró una dosis de 20 mg.');
  assert.equal(gold.find(item => item.runId.includes('ar-01-seeded')).seed.category, 'negation');
  assert(variants.every(item => !Object.hasOwn(item, 'seed')));
});

test('v2 negation mutation refuses a drifted draft', () => {
  const es = 'No 20 mg';
  assert.throws(() => makeNegationVariants({ drafts: [
    { caseId: 'synthetic-es-01', draft: es, draftSha256: sha256(es) }
  ] }), /span|altered|missing/i);
});
