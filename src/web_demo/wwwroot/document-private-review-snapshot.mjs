import { validRenderDimensions } from './document-render-limits.mjs';

const sourceKeys = ['caseId','physicalPage','pageId','sourceSha256','pageImageSha256','pdfUserUnit',
  'frame','nativeFragmentIds','sourceRenderEquivalence','canonicalFragmentCrosswalk'];
const frameKeys = ['viewBox','rotation','scale','transform','width','height'];
const regionTypes = new Set(['heading','paragraph','table','equation','figure','caption','footnote','other']);
const nonempty = value => typeof value === 'string' && !!value.trim();
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

function exact(value, keys) {
  return value && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value,key));
}

// Reject accessors and serialization losses before reading values or cloning.
// The limits bound local snapshot data, not upstream decoder execution.
function dataOnly(value, seen = new Set(), depth = 0) {
  if (value === null || ['string','boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth > 64 || typeof value !== 'object' || seen.has(value) ||
      (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value)))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const array = Array.isArray(value), length = array ? descriptors.length?.value : 0;
  if (array && (!Number.isSafeInteger(length) || length > 262144 || keys.length !== length + 1 ||
      keys.some(key => key !== 'length' && (typeof key !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) return false;
  seen.add(value);
  const valid = keys.every(key => typeof key === 'string' && Object.hasOwn(descriptors[key],'value') &&
    (descriptors[key].enumerable || (array && key === 'length')) &&
    dataOnly(descriptors[key].value,seen,depth+1));
  seen.delete(value);
  return valid;
}

function snapshot(value) {
  if (!dataOnly(value) || JSON.stringify(value).length > 262144) throw new TypeError('Invalid or oversized snapshot data');
  return structuredClone(value);
}

function validFrame(source, page) {
  const frame = source.frame;
  if (!exact(frame,frameKeys) || !Array.isArray(frame.viewBox) || frame.viewBox.length !== 4 ||
      !frame.viewBox.every(Number.isFinite) || !Array.isArray(frame.transform) || frame.transform.length !== 6 ||
      !frame.transform.every(Number.isFinite) || ![0,90,180,270].includes(frame.rotation) ||
      !Number.isFinite(frame.scale) || frame.scale <= 0 || frame.scale > 3 ||
      !Number.isFinite(source.pdfUserUnit) || source.pdfUserUnit <= 0) return false;
  const [left,bottom,right,top] = frame.viewBox, scale = frame.scale * source.pdfUserUnit;
  if (!(right > left && top > bottom) || !Number.isFinite(scale)) return false;
  const rotated = frame.rotation === 90 || frame.rotation === 270;
  const width = Math.ceil((rotated ? top-bottom : right-left)*scale);
  const height = Math.ceil((rotated ? right-left : top-bottom)*scale);
  const matrices = {
    0: [scale,0,0,-scale,-left*scale,top*scale],
    90: [0,scale,scale,0,-bottom*scale,-left*scale],
    180: [-scale,0,0,scale,right*scale,-bottom*scale],
    270: [0,-scale,-scale,0,top*scale,right*scale]
  };
  return validRenderDimensions(width,height) && frame.width === width && frame.height === height &&
    page.width === width && page.height === height && matrices[frame.rotation].every((n,i) =>
      Math.abs(n-frame.transform[i]) <= 1e-7);
}

function validateAssociation(sources, pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 2 ||
      !Array.isArray(sources) || sources.length !== pages.length) throw new TypeError('Source association required');
  const cases = new Set(), physical = new Set(), regions = new Set();
  for (let i=0;i<pages.length;i++) {
    const page = pages[i], source = sources[i];
    if (!exact(source,sourceKeys) || !nonempty(source.caseId) || source.caseId.length > 256 ||
        !Number.isSafeInteger(source.physicalPage) || source.physicalPage < 1 || source.physicalPage > 512 ||
        source.pageId !== `p${i+1}` || source.pageId !== page.id ||
        cases.has(source.caseId) || physical.has(source.physicalPage) ||
        !digest(source.sourceSha256) || !digest(source.pageImageSha256) ||
        source.sourceSha256.toLowerCase() !== sources[0].sourceSha256.toLowerCase() ||
        source.sourceRenderEquivalence !== 'unverified' || source.canonicalFragmentCrosswalk !== 'unavailable' ||
        !validFrame(source,page)) throw new TypeError('Invalid declared source identity or frame');
    cases.add(source.caseId); physical.add(source.physicalPage);
    const ids = source.nativeFragmentIds;
    if (!Array.isArray(ids) || ids.length > 8192 || !ids.every((id,n) => id === `${page.id}-f${n}`) ||
        !Array.isArray(page.fragmentIds) || page.fragmentIds.length !== ids.length ||
        !page.fragmentIds.every((id,n) => id === ids[n]) ||
        !Array.isArray(page.regions) || page.regions.length > 256 ||
        !Array.isArray(page.edges) || page.edges.length > 1024 || !Array.isArray(page.issues) ||
        typeof page.visualInventoryConfirmed !== 'boolean') throw new TypeError('Invalid page inventory');
    const native = new Set(ids);
    for (const region of page.regions) {
      const box = region.box;
      if (!nonempty(region.id) || regions.has(region.id) || !regionTypes.has(region.type) ||
          typeof region.text !== 'string' || !nonempty(region.provenance) ||
          !['proposed','verified','unresolved','excluded'].includes(region.status) ||
          !Array.isArray(region.fragmentIds) || !region.fragmentIds.every(id => native.has(id)) ||
          new Set(region.fragmentIds).size !== region.fragmentIds.length || !box ||
          ![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 ||
          box.width <= 0 || box.height <= 0 || box.x+box.width > page.width || box.y+box.height > page.height)
        throw new TypeError('Invalid source region');
      regions.add(region.id);
    }
  }
}

/** Data-only declared association, not PDF authentication or pixel equivalence. */
export function capturePrivateSourcePages(sourcePages, pages) {
  const captured = snapshot({sourcePages,pages});
  validateAssociation(captured.sourcePages,captured.pages);
  return captured.sourcePages;
}

/** Memory-only DRAFT; no human authority, event history, score or files. */
export function createPrivateReviewSnapshot(request) {
  try {
    const captured = snapshot(request);
    if (!exact(captured,['document','sourcePages','sourceGeneration']) ||
        !Number.isSafeInteger(captured.sourceGeneration) || captured.sourceGeneration < 1 ||
        captured.document?.schemaVersion !== 1 || !Array.isArray(captured.document.selectedRegionIds))
      throw new TypeError('Invalid snapshot request');
    validateAssociation(captured.sourcePages,captured.document.pages);
    return {status:'DRAFT',...captured,
      manualReview:{eventCapture:'unavailable',editCount:null,durationSeconds:null}};
  } catch {
    return {status:'ABSTAIN',reason:'INVALID_OR_MISSING_PRIVATE_SOURCE_SNAPSHOT'};
  }
}
