// Bounded numeric-path custody for diagnostic capture; no visibility or table admission certificate.
import { encodeDiagnosticValue } from './document-diagnostic-value.mjs';

const CAPS = Object.freeze({ maxOps: 4096, maxPaths: 256, maxNodes: 20000, maxEntries: 100000,
  maxBytes: 1048576, maxStringUnits: 262144, maxDepth: 16, maxWork: 2000000 });
const leases = new WeakMap();
const TA = Object.getPrototypeOf(Uint8Array.prototype);
const getters = Object.fromEntries(['buffer', 'byteOffset', 'byteLength', 'length'].map(k => [k, Object.getOwnPropertyDescriptor(TA, k).get]));
const typedPrototypes = new Set([Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array].map(C => C.prototype));
const own = (v, k) => { const d = Object.getOwnPropertyDescriptor(v, k); return d && 'value' in d ? d : null; };
const sameFlags = (a, b) => !!a && !!b && 'value' in a && 'value' in b && a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
function method(obj, key) {
  let p = obj;
  for (let n = 0; p && n < 8; n++, p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return 'value' in d && typeof d.value === 'function' ? { owner: p, descriptor: d, value: d.value } : null;
  }
  return null;
}
function errorKind(value) {
  if (value === null) return { type: 'null' };
  const type = typeof value;
  if (type === 'string') return value.length <= 512 ? { type, value } : { type, prefix: value.slice(0, 512), truncated: true };
  if (type === 'number') return { type, value: Object.is(value, -0) ? '-0' : String(value) };
  if (type === 'boolean') return { type, value };
  return { type }; // Never inspect an arbitrary error object's message/prototype or convert bigint/symbol.
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const k of Object.keys(value)) freeze(value[k]); Object.freeze(value); }
  return value;
}

export function install(options) {
  const s = { problems: [], calls: [], refusals: [], dispatchRefusalOverflow: false, work: 0, copiedBytes: 0, nodes: 0, entries: 0, stringUnits: 0,
    disposed: false, methodRestored: false, active: false, cursor: 0, graph: [], leased: [], paths: [], validationCost: 0 };
  let limits = { ...CAPS }, graphics, prepared, actual, getActual, original, numeric, named, oldDescriptor, wrapper, installed = false;
  const STOP = {};
  function poison(reason) { if (!s.problems.includes(reason) && s.problems.length < 16) s.problems.push(reason); }
  s.poison = poison;
  function stop(reason) { poison(reason); throw STOP; }
  function work(n) { if (n > limits.maxWork - s.work) stop('work-limit'); s.work += n; }
  function charge(field, n, cap, reason) { if (n > limits[cap] - s[field]) stop(reason); s[field] += n; }
  function text(v) { charge('stringUnits', v.length, 'maxStringUnits', 'string-limit'); work(v.length); }
  function view(v) { return Object.fromEntries(Object.entries(getters).map(([k, get]) => [k, Reflect.apply(get, v, [])])); }
  const byRef = new Map();
  function capture(v, depth = 0) {
    work(1);
    if (typeof v === 'string') { text(v); return; }
    if (v === null || v === undefined || ['number', 'boolean'].includes(typeof v)) return;
    if (typeof v !== 'object') stop('unsupported-data');
    if (byRef.has(v)) return;
    if (depth > limits.maxDepth) stop('depth-limit');
    charge('nodes', 1, 'maxNodes', 'node-limit');
    const proto = Object.getPrototypeOf(v), array = Array.isArray(v), typed = typedPrototypes.has(proto);
    if (!array && !typed && proto !== Object.prototype && proto !== null) stop('unsupported-prototype');
    if (array && proto !== Array.prototype) stop('unsupported-prototype');
    const n = { ref: v, proto, keys: [], descriptors: [], typed: null, arrayLength: null }; byRef.set(v, n); s.graph.push(n);
    if (array) { const d = own(v, 'length'); if (!d || d.value > limits.maxEntries - s.entries) stop('entry-limit'); n.arrayLength = d.value; }
    if (typed) {
      const t = view(v);
      if (t.length > limits.maxEntries - s.entries) stop('entry-limit');
      charge('copiedBytes', t.byteLength, 'maxBytes', 'byte-limit'); work(t.byteLength);
      n.typed = { ...t, bytes: new Uint8Array(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
    }
    // Native ownKeys allocation and hostile Proxy behaviour are outside this bounded source profile.
    const keys = Reflect.ownKeys(v); charge('entries', keys.length, 'maxEntries', 'entry-limit'); work(keys.length);
    for (const k of keys) {
      if (typeof k !== 'string') stop('symbol-key'); text(k);
      const d = own(v, k); if (!d) stop('accessor-or-missing');
      n.keys.push(k); n.descriptors.push(d); capture(d.value, depth + 1);
    }
    s.validationCost += 2 + keys.length * 2 + keys.reduce((n, k) => n + k.length, 0) + (n.typed?.byteLength ?? 0);
  }
  function validate(slot = null) {
    work(s.validationCost); // Reserve full known inspection cost before any repeated graph traversal.
    for (const n of s.graph) {
      if (Object.getPrototypeOf(n.ref) !== n.proto) return false;
      if (n.arrayLength !== null && own(n.ref, 'length')?.value !== n.arrayLength) return false;
      if (n.typed) {
        const t = n.typed;
        // Saved range access actually throws after detachment, preserving a distinct observation fault.
        const bytes = new Uint8Array(t.buffer, t.byteOffset, t.byteLength), now = view(n.ref);
        if (now.buffer !== t.buffer || now.byteOffset !== t.byteOffset || now.byteLength !== t.byteLength || now.length !== t.length) return false;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== t.bytes[i]) return false;
      }
      const keys = Reflect.ownKeys(n.ref);
      if (keys.length !== n.keys.length) return false;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i], d = own(n.ref, key), before = n.descriptors[i];
        if (key !== n.keys[i] || !sameFlags(d, before) || !(n.ref === slot && key === '0') && !Object.is(d.value, before.value)) return false;
      }
    }
    return true;
  }
  function equivalent(a, b, left = new Map(), right = new Map()) {
    work(1);
    if (typeof a === 'string') work(a.length);
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return Object.is(a, b);
    if (left.has(a)) return left.get(a) === b;
    if (right.has(b)) return false;
    const x = byRef.get(a), y = byRef.get(b); if (!x || !y || x.proto !== y.proto || x.keys.length !== y.keys.length) return false;
    left.set(a, b); right.set(b, a);
    work(x.keys.length);
    for (let i = 0; i < x.keys.length; i++) {
      if (x.keys[i] !== y.keys[i] || !sameFlags(x.descriptors[i], y.descriptors[i]) || !equivalent(x.descriptors[i].value, y.descriptors[i].value, left, right)) return false;
    }
    return true;
  }
  function stroke(args) {
    if (!Array.isArray(args) || args.length !== 3 || args[0] !== 20 || !Array.isArray(args[1]) || args[1].length !== 1) return false;
    const raw = args[1][0], box = args[2];
    if (Object.getPrototypeOf(raw ?? {}) !== Float32Array.prototype || Object.getPrototypeOf(box ?? {}) !== Float32Array.prototype || raw.length !== 6 || box.length !== 4) return false;
    for (let i = 0; i < 6; i++) if (!Number.isFinite(raw[i])) return false;
    return raw[0] === 0 && raw[3] === 1 && raw[2] === raw[5] && raw[4] > raw[1] &&
      Object.is(box[0], raw[1]) && Object.is(box[1], raw[2]) && Object.is(box[2], raw[4]) && Object.is(box[3], raw[5]);
  }
  function profile() {
    const f = own(prepared, 'fnArray')?.value, a = own(prepared, 'argsArray')?.value;
    const af = own(actual, 'fnArray')?.value, aa = own(actual, 'argsArray')?.value;
    if (![f, a, af, aa].every(Array.isArray) || f.length !== a.length || f.length !== af.length || a.length !== aa.length || f.length > limits.maxOps) stop('inventory-mismatch');
    work(f.length); let textDepth = 0, saveDepth = 0;
    for (let i = 0; i < f.length; i++) {
      if (!Number.isSafeInteger(f[i]) || f[i] < 0) stop('invalid-operator');
      if (f[i] === 31) { if (textDepth++) stop('text-scope'); }
      if (f[i] === 32 && --textDepth !== 0) stop('text-scope');
      if (f[i] === 10) saveDepth++;
      if (f[i] === 11 && --saveDepth < 0) stop('save-scope');
      if (f[i] !== 91) continue;
      if (s.paths.length >= limits.maxPaths) stop('path-limit');
      const args = a[i];
      const empty = Array.isArray(args) && args.length === 3 && args[0] === 28 && Array.isArray(args[1]) && args[1].length === 1 && args[1][0] === null && args[2] === null;
      if (textDepth || !(stroke(args) || empty && f[i + 1] === 91 && stroke(a[i + 1]))) stop('unsupported-path');
      s.paths.push(i);
    }
    if (textDepth || saveDepth || !s.paths.length) stop('unbalanced-or-no-paths');
    const left = new Map(), right = new Map();
    if (!equivalent(f, af, left, right) || !equivalent(a, aa, left, right)) stop('source-actual-mismatch');
  }
  function identity() {
    const m = method(graphics, '91'), n = method(graphics, 'constructPath');
    return m?.owner === graphics && m.value === wrapper && sameFlags(m.descriptor, { value: wrapper, enumerable: oldDescriptor?.enumerable ?? false, writable: true, configurable: true }) &&
      n?.owner === named.owner && n.value === original && sameFlags(n.descriptor, named.descriptor);
  }
  function checkTask() { if (getActual() !== actual) stop('actual-substituted'); }
  function record(event) { if (s.calls.length < CAPS.maxPaths) s.calls.push(event); else poison('event-limit'); }
  wrapper = function(...args) {
    const [index, op, data, bounds] = args;
    const event = { index: Number.isSafeInteger(index) ? index : null, op: Number.isSafeInteger(op) ? op : null,
      supported: false, forwarded: 0, validAfter: false, restored: false, hasThrown: false, originalError: null, observationError: null };
    let result, thrown, raw, cell; const wasActive = s.active; s.active = true;
    try {
      if (wasActive) stop('reentrant');
      if (s.disposed) stop('disposed-dispatch');
      if (!s.problems.length) {
        checkTask();
        if (!identity() || this !== graphics || args.length !== 4 || index !== s.paths[s.cursor] || !validate()) stop('pre-custody');
        const expected = own(own(actual, 'argsArray').value, String(index))?.value;
        if (!expected || expected[0] !== op || expected[1] !== data || expected[2] !== bounds) stop('call-correspondence');
        cell = own(data, '0'); if (!cell?.writable) stop('nonwritable-cell'); raw = cell.value;
        event.supported = true; s.cursor++;
      }
    } catch (error) { if (error !== STOP) { event.observationError = 'pre-observation-failed'; poison(event.observationError); } }
    try { event.forwarded++; result = Reflect.apply(original, this, args); }
    catch (error) { event.hasThrown = true; thrown = error; event.originalError = errorKind(error); }
    // Even a thrown original may also detach a buffer. Observe independently, never mask its throw.
    try {
      if (event.supported && !s.problems.length) {
        checkTask(); const now = own(data, '0');
        const exact = identity() && validate(data) && sameFlags(now, cell) && now.value !== raw && typeof now.value === 'object' && now.value !== null;
        event.validAfter = !!exact && !event.hasThrown;
        if (event.validAfter) { Object.defineProperty(data, '0', cell); event.restored = validate(); if (!event.restored) poison('restore-custody'); }
        else poison('unexpected-write-or-scope');
      }
    } catch (error) { if (error !== STOP) { event.observationError = 'post-observation-failed'; poison(event.observationError); } }
    if (event.hasThrown) poison('original-threw');
    s.active = wasActive; record(event);
    if (event.hasThrown) throw thrown;
    return result;
  };
  try {
    if (!options || typeof options !== 'object') stop('invalid-options');
    graphics = own(options, 'graphics')?.value; prepared = own(options, 'prepared')?.value; actual = own(options, 'actual')?.value;
    for (const k of ['getActual', 'limits']) if (Object.getOwnPropertyDescriptor(options, k) && !own(options, k)) stop('invalid-options');
    getActual = own(options, 'getActual')?.value ?? (() => actual);
    if (!graphics || typeof graphics !== 'object' || typeof getActual !== 'function') stop('invalid-options');
    numeric = method(graphics, '91'); named = method(graphics, 'constructPath');
    if (!numeric || !named || numeric.value !== named.value) stop('method-identity');
    original = numeric.value; oldDescriptor = Object.getOwnPropertyDescriptor(graphics, '91');
    const given = own(options, 'limits')?.value;
    if (given !== undefined) {
      if (!given || typeof given !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(given))) stop('invalid-limits');
      const keys = Reflect.ownKeys(given); if (keys.length > Object.keys(CAPS).length) stop('invalid-limits');
      for (const k of keys) { const d = own(given, k); if (typeof k !== 'string' || !Object.hasOwn(CAPS, k) || !d || !Number.isSafeInteger(d.value) || d.value < 0 || d.value > CAPS[k]) stop('invalid-limits'); limits[k] = d.value; }
    }
    try {
      work(4);
      for (const list of [prepared, actual]) {
        const fn = own(list, 'fnArray')?.value, args = own(list, 'argsArray')?.value;
        if (!Array.isArray(fn) || !Array.isArray(args) || fn.length !== args.length || fn.length > limits.maxOps) stop('inventory-mismatch');
      }
      capture(prepared); capture(actual); profile(); checkTask();
      for (const n of s.graph) for (const ref of n.typed ? [n.ref, n.typed.buffer] : [n.ref]) {
        work(1); const previous = leases.get(ref);
        if (previous && previous !== s) { previous.poison('shared-operand-lease'); poison('shared-operand-lease'); }
        else { leases.set(ref, s); s.leased.push(ref); }
      }
    } catch (error) { if (error !== STOP) poison('initial-observation-failed'); }
    Object.defineProperty(graphics, '91', { value: wrapper, enumerable: oldDescriptor?.enumerable ?? false, writable: true, configurable: true }); installed = true;
  } catch (error) { if (error !== STOP) poison('installation-failed'); }
  function state() {
    const value = { complete: s.disposed && s.methodRestored && !s.problems.length && s.cursor === s.paths.length && s.calls.length === s.paths.length,
      calls: s.calls.map(c => ({ ...c, originalError: c.originalError ? { ...c.originalError } : null })),
      refusals: s.refusals.map(r => ({ ...r })), dispatchRefusalOverflow: s.dispatchRefusalOverflow,
      problems: [...s.problems], methodRestored: s.methodRestored, disposed: s.disposed,
      stats: { work: s.work, copiedBytes: s.copiedBytes, nodes: s.nodes, entries: s.entries, stringUnits: s.stringUnits } };
    const report = encodeDiagnosticValue(value);
    if (report.status !== 'complete') { value.complete = false; value.problems.push('reporting-limit-or-unknown'); }
    // The codec is a representation of normalized data, not an identity/budget/visibility certificate.
    return freeze(value);
  }
  function refuseDispatch() {
    poison('dispatch-refused');
    if (s.refusals.length < CAPS.maxPaths) s.refusals.push({ reason: 'invalid-dispatch-request' });
    else s.dispatchRefusalOverflow = true;
    // A diagnostic refusal is separate from an exception thrown by an entered original.
    // Do not coerce or retain the unreadable index, argument object or reflection exception.
    throw new TypeError('Diagnostic dispatch requires a nonnegative integer index and an own-data path argument triple');
  }
  return Object.freeze({
    dispatch(index) {
      let values = null;
      try {
        // Convert only bounded primitive integers. Unpack by descriptors, never by source getters.
        if (Number.isSafeInteger(index) && index >= 0 && !Object.is(index, -0)) {
          const a = own(own(actual, 'argsArray')?.value, String(index))?.value;
          if (Array.isArray(a) && own(a, 'length')?.value === 3) {
            const op = own(a, '0'), data = own(a, '1'), bounds = own(a, '2');
            if (op && data && bounds) values = [op.value, data.value, bounds.value];
          }
        }
      } catch { /* Reflection faults are diagnostic refusal, not original exceptions. */ }
      if (!values || typeof original !== 'function') return refuseDispatch();
      // Handle calls retain the cached original even after a foreign numeric slot replacement.
      // That foreign property is preserved and diagnostics stay held; external calls are not intercepted.
      // Keep original invocation outside preflight's catch so its exact throw value survives.
      return Reflect.apply(wrapper, graphics, [index, values[0], values[1], values[2]]);
    }, state,
    dispose() {
      if (s.disposed) return state();
      try { if (!s.problems.length) { checkTask(); if (!identity() || !validate()) poison('seal-custody'); } }
      catch (error) { if (error !== STOP) poison('seal-observation-failed'); }
      try {
        const now = Object.getOwnPropertyDescriptor(graphics ?? {}, '91');
        if (!installed || !now || !('value' in now) || now.value !== wrapper) poison('foreign-or-uninstalled-method');
        else {
          if (oldDescriptor) Object.defineProperty(graphics, '91', oldDescriptor); else if (!delete graphics[91]) throw Error('delete-failed');
          const restored = Object.getOwnPropertyDescriptor(graphics, '91');
          s.methodRestored = oldDescriptor ? sameFlags(restored, oldDescriptor) && restored.value === original : !restored && method(graphics, '91')?.value === original;
          if (!s.methodRestored) poison('method-restore-failed');
        }
      } catch { poison('method-restore-failed'); }
      for (const ref of s.leased) if (leases.get(ref) === s) leases.delete(ref);
      s.disposed = true;
      return state();
    }
  });
}
