import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const variantModule = await import('./make_variants.mjs').catch(() => ({}));
const hash = text => createHash('sha256').update(text).digest('hex');

test('controlled mutations change only one agreed span and keep gold separate', () => {
  assert.equal(typeof variantModule.makeVariants, 'function');
  const drafts = { drafts: [
    { caseId: 'synthetic-ko-01', targetLanguage: 'ko', draft: '근위부 2.5 mm', draftSha256: hash('근위부 2.5 mm') },
    { caseId: 'synthetic-es-01', targetLanguage: 'es', draft: '2 mg and 20 mg', draftSha256: hash('2 mg and 20 mg') },
    { caseId: 'synthetic-ar-01', targetLanguage: 'ar', draft: '1.8 مم', draftSha256: hash('1.8 مم') }
  ] };
  const { variants, gold } = variantModule.makeVariants(drafts);
  assert.equal(variants.length, 6);
  assert.equal(gold.length, 6);
  assert.equal(variants.find(item => item.runId === 'synthetic-ko-01-seeded').draft, '원위부 2.5 mm');
  assert.equal(variants.find(item => item.runId === 'synthetic-es-01-seeded').draft, '3 mg and 20 mg');
  assert.equal(variants.find(item => item.runId === 'synthetic-ar-01-seeded').draft, '8.1 مم');
  assert.equal(gold.find(item => item.runId === 'synthetic-ko-01-seeded').seed.category, 'direction');
  assert(variants.every(item => !Object.hasOwn(item, 'seed') && !Object.hasOwn(item, 'category')),
    'gold labels entered model-facing variant objects');
});

test('unexpected draft text or hash refuses silent mutation', () => {
  const bad = { drafts: [{ caseId: 'synthetic-ko-01', targetLanguage: 'ko', draft: 'no direction term', draftSha256: hash('no direction term') }] };
  assert.throws(() => variantModule.makeVariants(bad), /expected|span|case/i);
});
