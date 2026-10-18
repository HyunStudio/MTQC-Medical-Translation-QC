import { createHash } from 'node:crypto';
import { validRenderDimensions } from '../web_demo/wwwroot/document-render-limits.mjs';
import { projectReviewedObservations } from './structure-projection.mjs';
import { validateTruthLock, validateTruthCases, validateReviewedCases } from '../web_demo_browser_tests/structure-replay.mjs';
import { MAX_PRIVATE_PDF_BYTES, MAX_PRIVATE_AUX_BYTES } from './structure-private-byte-limits.mjs';

const MAX_PAYLOAD_CHARS = 262144;
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const abstain = reason => ({ status: 'ABSTAIN', reason });
const nonempty = value => typeof value === 'string' && !!value.trim();
const regionTypes = new Set(['heading','paragraph','table','equation','figure','caption','footnote','other']);
const bindingKeys = new Set(['id','reviewed','regionId','edgeId','cellId','labelId','canonicalRegionId',
  'canonicalCellIds','canonicalRegionIds','issueCode']);
const requestKeys = ['selection','sourceBytes','pageImageBytes','pageId','checklist','document','bindings'];

function captureRequest(value, keys = requestKeys) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError('Plain request required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value')))
    throw new TypeError('Request must have exactly the declared enumerable data fields');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function idOnlyBindings(bindings) {
  if (!Array.isArray(bindings)) return false;
  return bindings.every(binding => {
    if (!binding || typeof binding !== 'object') return false;
    const descriptors = Object.getOwnPropertyDescriptors(binding);
    if (!Reflect.ownKeys(descriptors).every(key => bindingKeys.has(key) &&
      Object.hasOwn(descriptors[key], 'value'))) return false;
    if (!nonempty(descriptors.id?.value)) return false;
    return Object.entries(descriptors).every(([key, descriptor]) => {
      const value = descriptor.value;
      if (key === 'reviewed') return typeof value === 'boolean';
      if (['canonicalCellIds','canonicalRegionIds'].includes(key)) return Array.isArray(value) && value.every(entry => {
        if (!entry || typeof entry !== 'object') return false;
        const ids = Object.getOwnPropertyDescriptors(entry);
        return Reflect.ownKeys(ids).length === 2 && Reflect.ownKeys(ids).every(id =>
          ['id','canonicalId'].includes(id) && Object.hasOwn(ids[id], 'value') && nonempty(ids[id].value));
      });
      return nonempty(value);
    });
  });
}

function bytesSnapshot(value, maximum = MAX_PRIVATE_AUX_BYTES) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Actual byte array required');
  const length = typedLength.call(value);
  if (!length || length > maximum) throw new RangeError('Source byte limit');
  const copy = new Uint8Array(length);
  for (let index = 0; index < length; index++) copy[index] = value[index];
  return copy;
}

// This local authoring boundary accepts plain finite JSON data, never accessors,
// executable objects or JSON serialization that silently drops undefined data.
function jsonData(value, seen = new Set()) {
  if (value === null || ['string','boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value) ||
    (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value)))) return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const array = Array.isArray(value);
  const keys = Reflect.ownKeys(descriptors);
  if (array && (keys.length !== value.length + 1 || keys.some(key => key !== 'length' &&
    (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) return false;
  const valid = keys.every(key => typeof key === 'string' &&
    Object.hasOwn(descriptors[key], 'value') && (descriptors[key].enumerable || (array && key === 'length')) &&
    jsonData(descriptors[key].value, seen));
  seen.delete(value);
  return valid;
}

function boundedGraph(graph) {
  return graph?.schemaVersion === 1 && Array.isArray(graph.pages) && graph.pages.length >= 1 && graph.pages.length <= 2 &&
    graph.pages.every(page => validRenderDimensions(page.width, page.height) &&
      Array.isArray(page.regions) && page.regions.length <= 256 &&
      Array.isArray(page.edges) && page.edges.length <= 1024 && Array.isArray(page.issues) &&
      Array.isArray(page.fragmentIds) && page.fragmentIds.length <= 8192 && page.fragmentIds.every(nonempty) &&
      page.regions.every(region => regionTypes.has(region.type) && typeof region.text === 'string' &&
        ['proposed','verified','unresolved','excluded'].includes(region.status) && nonempty(region.provenance) &&
        Array.isArray(region.fragmentIds) && region.fragmentIds.every(nonempty) &&
        region.box && [region.box.x,region.box.y,region.box.width,region.box.height].every(Number.isFinite) &&
        region.box.x >= 0 && region.box.y >= 0 && region.box.width > 0 && region.box.height > 0 &&
        region.box.x + region.box.width <= page.width && region.box.y + region.box.height <= page.height));
}

/**
 * Node-only authoring snapshot, not a source provider or export approval.
 * Selection identity must be frozen independently. Hashing verifies byte
 * agreement only; it does not parse/authenticate PDF/PNG or prove graph accuracy.
 * No expected answers, human pass flags or verification statuses are invented.
 */
export function createReviewedArtifactDraft(request) {
  try {
    request = captureRequest(request);
    const checklist = request?.checklist;
    if (!Array.isArray(checklist) || !checklist.length || checklist.some(item => !item ||
      Reflect.ownKeys(item).length !== 2 || Reflect.ownKeys(item).some(key => !['id','kind'].includes(key)) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(item, 'id') || {}, 'value') ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(item, 'kind') || {}, 'value')))
      return abstain('CHECKLIST_NOT_ID_ONLY');
    if (!idOnlyBindings(request.bindings)) return abstain('BINDINGS_NOT_ID_ONLY');
    if (!jsonData(request.selection)) return abstain('INVALID_SELECTION_IDENTITY');
    const { caseId, sourceSha256, pageImageSha256, physicalPage } = structuredClone(request.selection);
    if (!nonempty(caseId) || !Number.isInteger(physicalPage) || physicalPage < 1 ||
      ![sourceSha256,pageImageSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)))
      return abstain('INVALID_SELECTION_IDENTITY');
    const source = bytesSnapshot(request.sourceBytes, MAX_PRIVATE_PDF_BYTES), image = bytesSnapshot(request.pageImageBytes);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    if (hash(source) !== sourceSha256.toLowerCase()) return abstain('SOURCE_BYTES_MISMATCH');
    if (hash(image) !== pageImageSha256.toLowerCase()) return abstain('PAGE_IMAGE_BYTES_MISMATCH');
    const payload = { document: request.document, bindings: request.bindings, checklist, pageId: request.pageId };
    if (!jsonData(payload) || JSON.stringify(payload).length > MAX_PAYLOAD_CHARS)
      return abstain('INVALID_OR_OVERSIZE_DRAFT');
    const snapshot = structuredClone(payload);
    if (!boundedGraph(snapshot.document)) return abstain('INVALID_OR_OVERSIZE_DRAFT');
    const identity = { caseId, sourceSha256, pageImageSha256, physicalPage };
    const artifact = { ...identity, pageId: snapshot.pageId, document: snapshot.document, bindings: snapshot.bindings };
    const observations = projectReviewedObservations({ truth: { ...identity, items: snapshot.checklist }, artifact });
    return { status: 'DRAFT', artifact, observations, manualEditCount: null, manualReviewSeconds: null };
  } catch {
    return abstain('INVALID_ARTIFACT_INPUT_OR_MAPPING');
  }
}

/**
 * Memory-only bundle preparation. Lock/pass declarations are checked, not
 * independently established here. Actual human truth and source authentication
 * remain operator prerequisites. No PDF candidates, files or flags are made.
 */
export function createReviewedBundleDraft(request) {
  try {
    request = captureRequest(request, ['manifest','truthBytes','requests']);
    if (!jsonData(request.manifest) || JSON.stringify(request.manifest).length > 1048576)
      return abstain('INVALID_BUNDLE_MANIFEST');
    const manifest = structuredClone(request.manifest);
    if (!Array.isArray(manifest.cases) || !manifest.cases.length || manifest.cases.length > 32 ||
      manifest.cases.some(value => !nonempty(value.caseId) || !Number.isInteger(value.page) || value.page < 1 ||
        ![value.sourceSha256,value.pageImageSha256].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash))) ||
      typeof manifest.truthSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.truthSha256))
      return abstain('INVALID_BUNDLE_MANIFEST');
    const truthBytes = bytesSnapshot(request.truthBytes);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    if (hash(truthBytes) !== manifest.truthSha256.toLowerCase()) return abstain('TRUTH_BYTES_MISMATCH');
    const truth = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(truthBytes));
    if (!jsonData(truth)) return abstain('INVALID_BUNDLE_TRUTH');
    validateTruthLock(manifest, truth);
    validateTruthCases(manifest.cases, truth.cases);
    // The scorer materializes expected fragment identities. Bound that count
    // before invoking scoring, even when the actual observation is unresolved.
    for (const value of truth.cases) for (const item of value.items) {
      if (item.kind !== 'fragment-coverage') continue;
      const expected = item.expected;
      const valid = expected && (Object.hasOwn(expected, 'fragmentCount')
        ? Number.isInteger(expected.fragmentCount) && expected.fragmentCount >= 0 && expected.fragmentCount <= 8192
        : Array.isArray(expected.fragmentIds) && expected.fragmentIds.length <= 8192 && expected.fragmentIds.every(nonempty));
      if (!valid) return abstain('INVALID_OR_OVERSIZE_TRUTH_COVERAGE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(request.requests);
    if (!Array.isArray(request.requests) || request.requests.length !== manifest.cases.length ||
      Reflect.ownKeys(descriptors).length !== manifest.cases.length + 1 ||
      !Array.from({ length: manifest.cases.length }, (_, i) => descriptors[String(i)]).every(value =>
        value?.enumerable && Object.hasOwn(value, 'value')))
      return abstain('INVALID_CASE_REQUESTS');
    const cases = [];
    for (let index = 0; index < manifest.cases.length; index++) {
      const draft = createReviewedArtifactDraft(descriptors[String(index)].value);
      if (draft.status !== 'DRAFT') return abstain(`CASE_DRAFT_REJECTED:${index}:${draft.reason}`);
      cases.push(draft.artifact);
    }
    const bundle = { schemaVersion: 1, truthSha256: manifest.truthSha256, cases,
      manualReview: { eventCapture: 'unavailable', editCount: null, durationSeconds: null } };
    validateReviewedCases(bundle, truth.cases, manifest.truthSha256);
    const json = JSON.stringify(bundle);
    if (json.length > 8388608) return abstain('OVERSIZE_BUNDLE');
    return { status: 'DRAFT', bundle, json, bundleSha256: hash(new TextEncoder().encode(json)) };
  } catch {
    return abstain('INVALID_BUNDLE_INPUT_OR_LOCK');
  }
}
