import { isDeepStrictEqual } from 'node:util';

const KINDS = new Set([
  'fragment-coverage', 'reading-edge', 'table-binding', 'formula-grouping',
  'figure-label', 'caption-link', 'unresolved-zone'
]);

function checkedIndex(observations, name, truthIds) {
  if (!Array.isArray(observations)) throw new TypeError(`${name} must be an observation array`);
  const byId = new Map();
  for (const observation of observations) {
    if (!observation || typeof observation.id !== 'string' || !observation.id.trim())
      throw new TypeError(`${name} contains an observation without an ID`);
    if (byId.has(observation.id)) throw new RangeError(`${name} has duplicate observation ID ${observation.id}`);
    if (!truthIds.has(observation.id)) throw new RangeError(`${name} has an unknown observation ID ${observation.id}`);
    if (!['proposed', 'verified', 'unresolved', 'excluded'].includes(observation.status))
      throw new TypeError(`${name} observation ${observation.id} has an invalid status`);
    if (name === 'proposal' && observation.status === 'verified')
      throw new TypeError(`Automatic proposal ${observation.id} cannot contain reviewer-verified status`);
    byId.set(observation.id, observation);
  }
  return byId;
}

function sameValue(expected, actual, kind) {
  if (kind === 'fragment-coverage') {
    const expectedIds = Number.isInteger(expected?.fragmentCount) && expected.fragmentCount >= 0
      ? Array.from({ length: expected.fragmentCount }, (_, index) => `${expected.pageId || 'p1'}-f${index}`)
      : expected?.fragmentIds;
    return Array.isArray(expectedIds) && Array.isArray(actual?.fragmentIds) &&
      isDeepStrictEqual([...expectedIds].sort(), [...actual.fragmentIds].sort());
  }
  if (kind === 'table-binding' && expected && actual) {
    const ordered = value => ({ ...value, headerCellIds: [...(value.headerCellIds || [])].sort() });
    return isDeepStrictEqual(ordered(expected), ordered(actual));
  }
  return isDeepStrictEqual(expected, actual);
}

function evaluate(items, observations, arm) {
  const failures = [];
  const byKind = {};
  let correct = 0;
  let silentErrors = 0;
  for (const item of items) {
    const observation = observations.get(item.id);
    const eligible = observation && observation.status !== 'unresolved' && observation.status !== 'excluded' &&
      (arm === 'automatic' || observation.status === 'verified');
    const matches = eligible && sameValue(item.expected, observation.value, item.kind);
    byKind[item.kind] ??= { correct: 0, total: 0 };
    byKind[item.kind].total++;
    if (matches) {
      correct++;
      byKind[item.kind].correct++;
      continue;
    }
    const reason = !observation ? 'missing' : observation.status === 'unresolved' || observation.status === 'excluded'
      ? observation.status : arm === 'reviewed' && observation.status !== 'verified'
        ? 'not-verified' : 'mismatch';
    if (arm === 'reviewed' && observation?.status === 'verified' && reason === 'mismatch') silentErrors++;
    failures.push({ id: item.id, kind: item.kind, reason });
  }
  return { result: { correct, total: items.length, byKind, ...(arm === 'reviewed' ? { silentErrors } : {}) }, failures };
}

/**
 * Score frozen visual-truth checklist items against two independent arms.
 * Automatic proposals are scored as extracted; reviewer corrections cannot
 * alter the automatic numerator. An unresolved or missing item stays in the
 * denominator. A wrong item marked verified is a release-blocking silent error.
 *
 * @param {{truth:{caseId:string,items:Array<{id:string,kind:string,expected:unknown}>},proposal:Array<{id:string,value:unknown,status:string}>,reviewed:Array<{id:string,value:unknown,status:string}>}} input
 */
export function scoreStructure({ truth, proposal, reviewed }) {
  if (!truth || typeof truth.caseId !== 'string' || !truth.caseId.trim() || !Array.isArray(truth.items) || !truth.items.length)
    throw new TypeError('Frozen truth needs a case ID and nonempty checklist');
  const truthIds = new Set();
  const denominators = {};
  for (const item of truth.items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || !KINDS.has(item.kind) || !Object.hasOwn(item, 'expected'))
      throw new TypeError('Frozen truth contains an invalid checklist item');
    if (truthIds.has(item.id)) throw new RangeError(`Frozen truth has duplicate checklist ID ${item.id}`);
    truthIds.add(item.id);
    denominators[item.kind] = (denominators[item.kind] || 0) + 1;
  }
  const automatic = evaluate(truth.items, checkedIndex(proposal, 'proposal', truthIds), 'automatic');
  const final = evaluate(truth.items, checkedIndex(reviewed, 'reviewed', truthIds), 'reviewed');
  return {
    caseId: truth.caseId,
    denominators,
    automatic: automatic.result,
    reviewed: final.result,
    failures: { automatic: automatic.failures, reviewed: final.failures }
  };
}
