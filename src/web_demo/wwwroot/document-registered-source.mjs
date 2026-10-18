import { validateDocumentStructure } from './document-structure.mjs';
import { validRenderDimensions } from './document-render-limits.mjs';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_GRAPH_CHARS = 262144;
const abstain = reason => ({ status: 'ABSTAIN', reason });
const sourceLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const regionTypes = new Set(['heading','paragraph','table','equation','figure','caption','footnote','other']);
const edgeTypes = new Set(['reading-next','caption-of','footnote-of','cell-of','label-in-figure']);
const identity = value => typeof value === 'string' && value.length > 0;
const uniqueIds = values => new Set(values.map(value => value.id)).size === values.length;

function typedPayload(region) {
  const table = region.table;
  if (table !== undefined && (!Array.isArray(table?.cells) || !uniqueIds(table.cells) ||
      ![table.rowCount, table.columnCount].every(Number.isInteger) ||
      !table.cells.every(cell => identity(cell.id) && typeof cell.text === 'string' &&
        [cell.row,cell.column,cell.rowSpan,cell.colSpan].every(Number.isInteger) &&
        ['header','value','blank'].includes(cell.role) && Array.isArray(cell.headerCellIds) &&
        cell.headerCellIds.every(identity) && new Set(cell.headerCellIds).size === cell.headerCellIds.length &&
        (cell.blankReason === undefined || typeof cell.blankReason === 'string')))) return false;
  const figure = region.figureReview;
  if (figure !== undefined && (!Array.isArray(figure?.labels) || !uniqueIds(figure.labels) ||
      !['labels-transcribed','no-internal-text'].includes(figure.decision) ||
      !figure.labels.every(label => identity(label.id) && typeof label.text === 'string'))) return false;
  const note = region.footnoteReview;
  if (note !== undefined && (!['linked','standalone'].includes(note?.decision) ||
      (note.standaloneReason !== undefined && typeof note.standaloneReason !== 'string'))) return false;
  return true;
}

function jsonData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  seen.add(value);
  const valid = Object.values(value).every(item => jsonData(item, seen));
  seen.delete(value);
  return valid;
}

function boundedGraph(document) {
  return jsonData(document) && JSON.stringify(document).length <= MAX_GRAPH_CHARS &&
    document?.schemaVersion === 1 && Array.isArray(document.pages) &&
    document.pages.length >= 1 && document.pages.length <= 2 &&
    Array.isArray(document.selectedRegionIds) && document.selectedRegionIds.every(identity) &&
    new Set(document.selectedRegionIds).size === document.selectedRegionIds.length &&
    document.selectedRegionIds.every(id => document.pages.some(page => page.regions.some(region => region.id === id))) &&
    new Set(document.pages.map(page => page.id)).size === document.pages.length &&
    document.pages.every(page => typeof page.id === 'string' && page.id.length > 0 &&
      validRenderDimensions(page.width, page.height) && Array.isArray(page.regions) && page.regions.length <= 256 &&
      page.regions.every(region => identity(region.id) && regionTypes.has(region.type) &&
        typeof region.text === 'string' && ['proposed','verified','excluded'].includes(region.status) &&
        identity(region.provenance) && Array.isArray(region.fragmentIds) && region.fragmentIds.every(identity) &&
        typedPayload(region)) &&
      Array.isArray(page.edges) && page.edges.length <= 1024 && Array.isArray(page.fragmentIds) &&
      page.fragmentIds.length <= 8192 && page.fragmentIds.every(identity) &&
      page.edges.every(edge => identity(edge.id) && edgeTypes.has(edge.type) && identity(edge.from) &&
        identity(edge.to) && ['proposed','verified'].includes(edge.status)) && Array.isArray(page.issues)) &&
    uniqueIds(document.pages.flatMap(page => page.edges));
}

function completelyVerified(document) {
  const ids = document.pages.flatMap(page => page.regions.map(region => region.id));
  const exactReviews = document.pages.every(page => page.regions.every(region =>
    (region.type !== 'table' || region.table?.reviewed === true) &&
    (region.type !== 'figure' || region.figureReview?.sourceChecked === true) &&
    (region.type !== 'equation' || region.equationReview?.sourceChecked === true) &&
    (region.type !== 'footnote' || region.footnoteReview?.sourceChecked === true)));
  // A page check alone cannot detect identities reused across different pages.
  return exactReviews && ids.length > 0 && new Set(ids).size === ids.length &&
    document.pages.every(page => page.visualInventoryConfirmed === true &&
      validateDocumentStructure(document, { scope: 'page', pageId: page.id }).ok) &&
    validateDocumentStructure(document, { scope: 'excerpt', selectedRegionIds: ids }).ok;
}

/**
 * Local operator-only registered-reference copying contract. resolveSource is a
 * protected application dependency, never a request field or public provider.
 * The operator is responsible for independently checking the registered graph
 * against the original source; a digest cannot establish that equivalence.
 * No production resolver or public UI is connected by this module.
 * Failure returns a reason with no partial document or output artifact.
 */
export async function restoreRegisteredSourceStructure(request, resolveSource) {
  if (typeof resolveSource !== 'function') return abstain('SOURCE_PROVIDER_UNAVAILABLE');
  let key, version, bytes;
  try {
    ({ key, version } = request);
    const input = request.sourceBytes;
    const length = input instanceof Uint8Array ? sourceLength.call(input) : 0;
    if (![key, version].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128) ||
        length === 0 || length > MAX_SOURCE_BYTES) return abstain('INVALID_SOURCE_REQUEST');
    // Typed-array construction copies internal bytes without invoking caller
    // slice(), iterator, species or an overridden length property.
    bytes = new Uint8Array(input);
  } catch { return abstain('INVALID_SOURCE_REQUEST'); }
  let sourceSha256;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    sourceSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return abstain('SOURCE_HASH_UNAVAILABLE'); }
  let registered;
  try { registered = await resolveSource(key, version); }
  catch { return abstain('SOURCE_PROVIDER_ERROR'); }
  if (!registered) return abstain('SOURCE_NOT_REGISTERED');
  let source;
  try {
    if (registered.version !== version) return abstain('SOURCE_VERSION_MISMATCH');
    if (typeof registered.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(registered.sourceSha256) ||
        registered.sourceSha256 !== sourceSha256) return abstain('SOURCE_HASH_MISMATCH');
    source = structuredClone(registered.document);
    if (!boundedGraph(source)) return abstain('REGISTERED_STRUCTURE_INVALID');
    if (!completelyVerified(source)) return abstain('REGISTERED_STRUCTURE_UNVERIFIED');
  } catch { return abstain('REGISTERED_STRUCTURE_INVALID'); }
  try {
    const restored = structuredClone(source);
    if (!boundedGraph(restored) || !completelyVerified(restored)) return abstain('RESTORED_STRUCTURE_INVALID');
    return { status: 'RESTORED', sourceSha256, sourceVersion: version,
      scope: 'operator-registered-selected-pages', document: restored };
  } catch { return abstain('RESTORED_STRUCTURE_INVALID'); }
}
