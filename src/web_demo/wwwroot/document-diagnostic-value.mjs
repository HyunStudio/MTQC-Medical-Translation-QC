// Data representation only. This unused helper certifies neither source/object identity nor rendering.
const CAPS = Object.freeze({ maxNodes: 4096, maxProperties: 16384, maxStringUnits: 131072, maxDepth: 16 });
const FORMAT = 'mtqc-diagnostic-value/1';

function freezeGenerated(value) {
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) freezeGenerated(Object.getOwnPropertyDescriptor(value, key).value);
    Object.freeze(value);
  }
  return value;
}

function limitsFor(input) {
  if (input === undefined) return CAPS;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length > 4) return null;
  const limits = { ...CAPS };
  for (const key of keys) {
    if (typeof key !== 'string' || !Object.hasOwn(CAPS, key)) return null;
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !('value' in d) || !Number.isSafeInteger(d.value) || d.value < 0 || d.value > CAPS[key]) return null;
    limits[key] = d.value;
  }
  return limits;
}

/**
 * Explicitly tagged own-data encoding, modulo canonical property order.
 * Unknown/truncated inputs have no partial value. Traversal/output budgets do not bound native
 * Reflect.ownKeys allocation or arbitrary Proxy/runtime behavior. No accessors or iterators are read.
 */
export function encodeDiagnosticValue(input, requestedLimits) {
  let limits;
  try { limits = limitsFor(requestedLimits); } catch { limits = null; }
  if (!limits) return freezeGenerated({ format: FORMAT, status: 'unknown', value: null, reason: 'invalid-limits', counts: null });
  const counts = { nodes: 0, properties: 0, stringUnits: 0 }, seen = new Set(), STOP = {};
  let status = 'complete', reason = null;
  const stop = (kind, why) => { status = kind; reason = why; throw STOP; };
  const charge = (field, amount, cap) => {
    if (amount > limits[cap] - counts[field]) stop('truncated', `${field}-limit`);
    counts[field] += amount;
  };
  const chargeString = value => charge('stringUnits', value.length, 'maxStringUnits');
  function visit(value, depth) {
    if (depth > limits.maxDepth) stop('truncated', 'depth-limit');
    charge('nodes', 1, 'maxNodes');
    if (value === undefined) return ['undefined'];
    if (value === null) return ['null'];
    switch (typeof value) {
      case 'boolean': return ['boolean', value];
      case 'number': return ['number', Object.is(value, -0) ? '-0' : String(value)];
      case 'string': chargeString(value); return ['string', value];
      case 'object': break;
      default: stop('unknown', 'unsupported-value-type');
    }
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) stop('unknown', 'unsupported-prototype');
    if (seen.has(value)) stop('unknown', 'shared-or-cyclic-reference');
    seen.add(value);
    let length = null;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(value, 'length');
      if (!d || !('value' in d) || !Number.isSafeInteger(d.value) || d.value < 0) stop('unknown', 'invalid-array-length');
      length = d.value;
      if (length > limits.maxProperties - counts.properties) stop('truncated', 'array-length-limit');
    }
    // Native enumeration necessarily occurs here; charge the inventory before descriptor iteration.
    const keys = Reflect.ownKeys(value);
    charge('properties', keys.length, 'maxProperties');
    for (const key of keys) {
      if (typeof key !== 'string') stop('unknown', 'symbol-property');
      chargeString(key);
    }
    keys.sort();
    const entries = [];
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !('value' in d)) stop('unknown', 'accessor-or-missing-property');
      entries.push([key, [d.enumerable, d.configurable, d.writable], visit(d.value, depth + 1)]);
    }
    return array ? ['array', length, entries] : ['object', proto === null ? 'null' : 'ordinary', entries];
  }
  let value = null;
  try { value = visit(input, 0); }
  catch (error) {
    value = null;
    if (error !== STOP) { status = 'unknown'; reason = 'inspection-error'; }
  }
  return freezeGenerated({ format: FORMAT, status, value, reason, counts });
}
