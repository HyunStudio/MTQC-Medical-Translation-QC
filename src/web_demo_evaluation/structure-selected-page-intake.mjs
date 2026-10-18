import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { validRenderDimensions } from '../web_demo/wwwroot/document-render-limits.mjs';
import { proposePageStructure } from '../web_demo/wwwroot/document-structure-proposal.mjs';
import { createDocumentStructure } from '../web_demo/wwwroot/document-structure.mjs';
import { pageHasRasterImages } from '../web_demo/wwwroot/document-raster-operators.mjs';
import { MAX_PRIVATE_PDF_BYTES, MAX_PRIVATE_AUX_BYTES } from './structure-private-byte-limits.mjs';

const require = createRequire(new URL('../web_demo_client/package.json', import.meta.url));
const { loadImage } = require('@napi-rs/canvas');
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const abstain = reason => ({ status: 'ABSTAIN', reason });
const nonempty = value => typeof value === 'string' && !!value.trim();
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

function fields(value, keys) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError('Plain data required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value'))) throw new TypeError('Exact data fields required');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function list(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError('Bounded list required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new TypeError('Dense list required');
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) throw new TypeError('Data list required');
    return descriptor.value;
  });
}
function bytes(value, maximum = MAX_PRIVATE_AUX_BYTES) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Byte array required');
  const length = typedLength.call(value);
  if (!length || length > maximum) throw new RangeError('Byte limit');
  const copy = new Uint8Array(length);
  for (let index = 0; index < length; index++) copy[index] = value[index];
  return copy;
}
function numbers(value, count) {
  const result = list(value, count);
  if (result.length !== count || !result.every(Number.isFinite)) throw new TypeError('Finite coordinate array required');
  return result;
}
function capture(request) {
  const top = fields(request, ['sourceBytes','selections']);
  const sourceBytes = bytes(top.sourceBytes, MAX_PRIVATE_PDF_BYTES);
  const rawSelections = list(top.selections, 2);
  if (!rawSelections.length) throw new TypeError('Selection required');
  const selections = rawSelections.map(raw => {
    raw = fields(raw, ['identity','canonicalImageBytes','frame']);
    const identity = fields(raw.identity, ['caseId','physicalPage','sourceSha256','pageImageSha256']);
    if (!nonempty(identity.caseId) || identity.caseId.length > 256 ||
      !Number.isInteger(identity.physicalPage) || identity.physicalPage < 1 ||
      !sha(identity.sourceSha256) || !sha(identity.pageImageSha256)) throw new TypeError('Source identity required');
    identity.sourceSha256 = identity.sourceSha256.toLowerCase();
    identity.pageImageSha256 = identity.pageImageSha256.toLowerCase();
    const frame = fields(raw.frame, ['viewBox','rotation','scale','transform','width','height']);
    frame.viewBox = numbers(frame.viewBox, 4); frame.transform = numbers(frame.transform, 6);
    if (![0,90,180,270].includes(frame.rotation) || !Number.isFinite(frame.scale) || frame.scale <= 0 || frame.scale > 3 ||
      !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || !validRenderDimensions(frame.width,frame.height))
      throw new TypeError('Bounded coordinate frame required');
    const canonicalImageBytes = bytes(raw.canonicalImageBytes);
    if (hash(sourceBytes) !== identity.sourceSha256 || hash(canonicalImageBytes) !== identity.pageImageSha256)
      throw new TypeError('Actual bytes mismatch');
    return { identity, canonicalImageBytes, frame };
  });
  if (new Set(selections.map(value => value.identity.caseId)).size !== selections.length ||
    new Set(selections.map(value => value.identity.physicalPage)).size !== selections.length) throw new TypeError('Duplicate selection');
  return { sourceBytes, selections };
}
function pngSize(image) {
  if (image.length < 33 || ![137,80,78,71,13,10,26,10].every((value,index) => image[index] === value) ||
    ![0,0,0,13,73,72,68,82].every((value,index) => image[index+8] === value)) throw new TypeError('PNG required');
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!validRenderDimensions(width,height)) throw new RangeError('PNG dimension limit');
  return { width, height };
}
function same(actual, declared) {
  return actual.length === declared.length && actual.every((value,index) => Math.abs(value - declared[index]) <= 1e-7);
}
function nativeVisibilityReason(ops, operators, commonObjs) {
  // Native text omits paint/optional-content state and clip lineage. These
  // conservative holds do not establish glyph/canonical visibility.
  const textOps = new Set([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText]);
  const paintOps = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill,
    ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke,
    ops.shadingFill, ops.paintXObject, ops.paintImageXObject, ops.paintInlineImageXObject,
    ops.paintImageMaskXObject, ops.paintImageXObjectRepeat, ops.paintImageMaskXObjectRepeat,
    ops.paintImageMaskXObjectGroup, ops.paintInlineImageXObjectGroup, ops.paintSolidColorImageMask]);
  const rasterOrShadingOps = new Set([ops.shadingFill, ops.paintXObject,
    ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject,
    ops.paintImageXObjectRepeat, ops.paintImageMaskXObjectRepeat,
    ops.paintImageMaskXObjectGroup, ops.paintInlineImageXObjectGroup, ops.paintSolidColorImageMask]);
  const fillOps = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke,
    ops.closeFillStroke, ops.closeEOFillStroke]);
  const strokeOps = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke,
    ops.closeFillStroke, ops.closeEOFillStroke]);
  const paintedFillColors = new Set();
  const defaults = { mode: 0, ca: 1, CA: 1, BM: 'source-over', SMask: false, TR: null };
  const frames = [], marked = [];
  let depth = 0, clipped = false, optionalDepth = 0, paint = { ...defaults }, font = null, fill = '#000000', stroke = '#000000';
  // q/Q and Form boundaries restore state, not pixels already painted. Keep
  // page-local draw history outside their frames; neither color nor bounds
  // establish whether a later shape covers earlier native glyphs.
  let seenText = false, latePaint = false, matchingBackground = false, earlierUnassessedPaint = false, textAfterUnassessedPaint = false;
  for (let index = 0; index < operators.fnArray.length; index++) {
    const operation = operators.fnArray[index];
    if (seenText && (paintOps.has(operation) ||
      (operation === ops.constructPath && paintOps.has(operators.argsArray[index][0])))) latePaint = true;
    const dispatched = operation === ops.constructPath ? operators.argsArray[index][0] : operation;
    // Remember solid fill and stroke draws, including those inside saved/Form
    // scopes. Restoring state or painting again does not prove erased ink.
    // Raster/shading and unknown colors cannot establish the background at
    // later text. Keep actual draw history, not mere resource/color declarations.
    if (rasterOrShadingOps.has(dispatched) ||
      (fillOps.has(dispatched) && fill === null) ||
      (strokeOps.has(dispatched) && stroke === null)) earlierUnassessedPaint = true;
    if (fillOps.has(dispatched) && fill !== null) paintedFillColors.add(fill);
    if (strokeOps.has(dispatched) && stroke !== null) paintedFillColors.add(stroke);
    if (operation === ops.save || operation === ops.paintFormXObjectBegin) {
      frames.push({ kind: operation, clipped, paint: { ...paint }, font, fill, stroke });
      if (operation === ops.paintFormXObjectBegin) depth++;
    } else if (operation === ops.restore) {
      const frame = frames.pop();
      if (!frame || frame.kind !== ops.save) return 'INVALID_GRAPHICS_OPERATOR_STRUCTURE';
      clipped = frame.clipped;
      paint = frame.paint;
      font = frame.font;
      fill = frame.fill;
      stroke = frame.stroke;
    }
    else if (operation === ops.paintFormXObjectEnd) {
      if (!depth) return 'INVALID_FORM_OPERATOR_STRUCTURE';
      const frame = frames.pop();
      if (!frame || frame.kind !== ops.paintFormXObjectBegin) return 'INVALID_FORM_OPERATOR_STRUCTURE';
      clipped = frame.clipped;
      paint = frame.paint;
      font = frame.font;
      fill = frame.fill;
      stroke = frame.stroke;
      depth--;
    } else if (operation === ops.setFont) font = operators.argsArray[index][0];
    else if (operation === ops.setFillRGBColor) {
      const color = operators.argsArray[index][0];
      fill = typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color) ? color.toLowerCase() : null;
    } else if (operation === ops.setStrokeRGBColor) {
      const color = operators.argsArray[index][0];
      stroke = typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color) ? color.toLowerCase() : null;
    } else if ([ops.setStrokeTransparent, ops.setStrokeColorN, ops.setStrokeColor, ops.setStrokeColorSpace,
      ops.setStrokeGray, ops.setStrokeCMYKColor].includes(operation)) stroke = null;
    else if ([ops.setFillTransparent, ops.setFillColorN, ops.setFillColor, ops.setFillColorSpace,
      ops.setFillGray, ops.setFillCMYKColor].includes(operation)) fill = null;
    else if (operation === ops.setTextRenderingMode) paint.mode = operators.argsArray[index][0];
    else if (operation === ops.setGState) {
      for (const [key, value] of operators.argsArray[index][0]) {
        if (key === 'Font') font = value[0];
        if (key !== 'mode' && Object.hasOwn(defaults, key)) paint[key] = value;
      }
    } else if (operation === ops.beginMarkedContent || operation === ops.beginMarkedContentProps) {
      const conditional = operation === ops.beginMarkedContentProps && operators.argsArray[index][0] === 'OC';
      marked.push(conditional);
      if (conditional) optionalDepth++;
    } else if (operation === ops.endMarkedContent) {
      if (!marked.length) return 'INVALID_MARKED_CONTENT_OPERATOR_STRUCTURE';
      if (marked.pop()) optionalDepth--;
    } else if (operation === ops.clip || operation === ops.eoClip ||
      (operation === ops.constructPath && [ops.clip, ops.eoClip].includes(operators.argsArray[index][0]))) clipped = true;
    else if (textOps.has(operation)) {
      if (depth) return 'FORM_NATIVE_VISIBILITY_UNASSESSED';
      if (clipped) return 'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED';
      if (optionalDepth) return 'OPTIONAL_CONTENT_NATIVE_VISIBILITY_UNASSESSED';
      if (Object.entries(defaults).some(([key, value]) => paint[key] !== value)) return 'TEXT_PAINT_NATIVE_VISIBILITY_UNASSESSED';
      // Type3 glyphs execute separate graphics programs, omitted from this page
      // operator traversal. Font declarations alone do not establish text use.
      if (typeof font !== 'string' || !commonObjs.has(font)) return 'FONT_NATIVE_VISIBILITY_UNASSESSED';
      const loaded = commonObjs.get(font);
      if (typeof loaded?.isType3Font !== 'boolean') return 'FONT_NATIVE_VISIBILITY_UNASSESSED';
      if (loaded.isType3Font) return 'TYPE3_NATIVE_VISIBILITY_UNASSESSED';
      // Native extraction does not establish contrast against the final scene.
      // Non-RGB/pattern fills replace the RGB state rather than inheriting it.
      if (fill === null) return 'FILL_COLOR_NATIVE_VISIBILITY_UNASSESSED';
      if (fill === '#ffffff') return 'WHITE_FILL_NATIVE_VISIBILITY_UNASSESSED';
      if (paintedFillColors.has(fill)) matchingBackground = true;
      if (earlierUnassessedPaint) textAfterUnassessedPaint = true;
      seenText = true;
    }
  }
  return depth ? 'INVALID_FORM_OPERATOR_STRUCTURE' : frames.length ? 'INVALID_GRAPHICS_OPERATOR_STRUCTURE' :
    marked.length ? 'INVALID_MARKED_CONTENT_OPERATOR_STRUCTURE' :
    latePaint ? 'LATE_PAINT_NATIVE_VISIBILITY_UNASSESSED' :
    matchingBackground ? 'BACKGROUND_NATIVE_VISIBILITY_UNASSESSED' :
    textAfterUnassessedPaint ? 'EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED' : null;
}
function operatorTextRunReason(pdfjs, operators, commonObjs, placements) {
  // Pinned PDF.js cursor advances only: these logical rectangles are not glyph ink,
  // a source/native crosswalk, or proof that text is duplicated or invisible.
  const unsupported = 'TEXT_RUN_POSITIONING_UNASSESSED';
  const identity = () => [1,0,0,1,0,0];
  const finite = (a, n) => (Array.isArray(a) || ArrayBuffer.isView(a)) &&
    a.length === n && Array.from(a).every(Number.isFinite);
  const exact = (a, b) => finite(a, b.length) && b.every((v,i) => a[i] === v);
  let state = { ctm: identity(), tm: identity(), font: null,
    size: 0, char: 0, word: 0, scale: 100, rise: 0, leading: 0, text: false,
    x: 0, y: 0, lineX: 0, lineY: 0 };
  const frames = [], rectangles = [];
  let glyphs = 0, runs = 0, checks = 0;
  const move = (x,y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError();
    state.x = state.lineX += x; state.y = state.lineY += y;
    if (![state.x,state.y].every(Number.isFinite)) throw new TypeError();
  };
  const ops = pdfjs.OPS;
  try {
    for (let i=0; i<operators.fnArray.length; i++) {
      const op = operators.fnArray[i], a = operators.argsArray[i];
      if (op === ops.save || op === ops.paintFormXObjectBegin) {
        frames.push({ kind: op, state: {...state, ctm:[...state.ctm], tm:[...state.tm]} });
      } else if (op === ops.restore || op === ops.paintFormXObjectEnd) {
        const f = frames.pop();
        if (!f || f.kind !== (op === ops.restore ? ops.save : ops.paintFormXObjectBegin)) return unsupported;
        state = f.state;
      } else if (op === ops.transform) {
        if (!finite(a,6)) return unsupported;
        state.ctm = pdfjs.Util.transform(state.ctm,a);
      } else if (op === ops.beginText) {
        if (state.text) return unsupported;
        state.text = true; state.tm = identity();
        state.x = state.y = state.lineX = state.lineY = 0;
      } else if (op === ops.endText) {
        if (!state.text) return unsupported;
        state.text = false;
      } else if (op === ops.setFont) {
        if (a.length !== 2 || typeof a[0] !== 'string' || !Number.isFinite(a[1])) return unsupported;
        [state.font,state.size] = a;
      } else if (op === ops.setGState) {
        for (const [key,value] of a[0]) if (key === 'Font') {
          if (value.length !== 2 || typeof value[0] !== 'string' || !Number.isFinite(value[1])) return unsupported;
          [state.font,state.size] = value;
        }
      } else if (op === ops.setTextMatrix) {
        // PDF.js 6.3.289 carries one Float32Array, not six flat arguments.
        if (a.length !== 1 || !finite(a[0],6)) return unsupported;
        state.tm = Array.from(a[0]);
        state.x = state.y = state.lineX = state.lineY = 0;
      } else if (op === ops.moveText || op === ops.setLeadingMoveText) {
        if (!finite(a,2)) return unsupported;
        if (op === ops.setLeadingMoveText) state.leading = -a[1];
        move(a[0],a[1]);
      } else if (op === ops.nextLine) move(0,-state.leading);
      else if ([ops.setCharSpacing,ops.setWordSpacing,ops.setHScale,ops.setTextRise,ops.setLeading].includes(op)) {
        if (!finite(a,1)) return unsupported;
        const key = op === ops.setCharSpacing ? 'char' : op === ops.setWordSpacing ? 'word' :
          op === ops.setHScale ? 'scale' : op === ops.setTextRise ? 'rise' : 'leading';
        state[key] = a[0];
      } else if ([ops.showText,ops.showSpacedText,ops.nextLineShowText,ops.nextLineSetSpacingShowText].includes(op)) {
        if (op !== ops.showText || a.length !== 1 || !Array.isArray(a[0])) return unsupported;
        const entries = a[0];
        if ((glyphs += entries.length) > 32768) return 'TEXT_RUN_GLYPH_LIMIT';
        if (!entries.length) continue;
        if (!state.text || pdfjs.version !== '6.3.289' || state.size <= 0 ||
          state.char !== 0 || state.word !== 0 || state.scale !== 100 || state.rise !== 0 ||
          !exact(state.ctm,identity()) || !finite(state.tm,6) ||
          !exact(state.tm.slice(0,4),[1,0,0,1]) || !commonObjs.has(state.font)) return unsupported;
        const font = commonObjs.get(state.font), matrix = font.fontMatrix, invalid = font.isInvalidPDFjsFont;
        if (font.isType3Font !== false || font.vertical !== false ||
          (invalid !== false && invalid !== undefined) ||
          (matrix !== undefined && !exact(matrix,[.001,0,0,.001,0,0]))) return unsupported;
        // Undefined uses the pinned renderer's FONT_IDENTITY_MATRIX fallback;
        // null, malformed matrices, unresolved or throwing getters do not.
        let width = 0, advance = 0;
        for (const glyph of entries) {
          if (!glyph || typeof glyph !== 'object' || !Number.isFinite(glyph.width) || glyph.width < 0) return unsupported;
          // Store positions only. Raw-path admission runs after existing reasons
          // on ALL selections; q/Q restores state, never painted history.
          placements.push({font,glyph,size:state.size,
            x:state.tm[4]+(state.x+advance),y:state.tm[5]+state.y});
          width += glyph.width;
          if (!Number.isFinite(width)) return unsupported;
          // Match the renderer's per-glyph accumulation order without epsilon.
          advance += glyph.width * (state.size * .001);
          if (!Number.isFinite(advance)) return unsupported;
        }
        // Keep fixed text-matrix translation separate from the local cursor,
        // including its accumulation order across consecutive text draws.
        const nextX = state.x + advance, start = state.tm[4] + state.x, end = state.tm[4] + nextX;
        if (!Number.isFinite(advance) || advance <= 0 || !Number.isFinite(nextX) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return unsupported;
        if (++runs > 8192) return 'TEXT_RUN_LIMIT';
        const y = state.tm[5] + state.y;
        const top = y + state.size;
        if (!Number.isFinite(y) || !Number.isFinite(top) || top <= y) return unsupported;
        rectangles.push({left:start, right:end, bottom:y, top});
        state.x = nextX;
      }
    }
    if (frames.length || state.text) return unsupported;
    // Validate all supported metrics and glyph/run budgets before pair work.
    // Scan a copy: state restoration never removes source draw history.
    // Font-size logical extents are not ascent/descent or glyph ink bounds.
    const sorted = [...rectangles].sort((a,b) => a.bottom - b.bottom);
    for (let i=0; i<sorted.length; i++) {
      const a = sorted[i];
      for (let j=i+1; j<sorted.length && sorted[j].bottom < a.top; j++) {
        // Initial candidate policy, not a measured performance guarantee.
        if (++checks > 65536) return 'TEXT_RUN_CHECK_LIMIT';
        const b = sorted[j];
        if (a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top)
          return 'OVERLAPPING_OPERATOR_TEXT_RUN_UNASSESSED';
      }
    }
    return null;
  } catch { return unsupported; }
}

function glyphEnvelopes(placements, commonObjs) {
  // Pinned PDF.js DrawOPS control-point envelopes, not exact curve/ink bounds.
  // These streams already include the font matrix. Never call getPathGenerator:
  // it can erase raw custody and turn a failed lookup into an empty Path2D.
  const unsupported = 'GLYPH_PATH_NATIVE_VISIBILITY_UNASSESSED';
  const paths = new Map(), envelopes = [];
  let scalars = 0;
  try {
    for (const {font,glyph,size,x,y} of placements) {
      // Fallback font custody remains an explicit limitation of legacy DRAFTs.
      // Acquired fonts require resolved raw paths; a compiled cache is no proof.
      if (font.missingFile !== false) continue;
      if (font.remeasure === true || glyph.accent || glyph.isInFont === false ||
        typeof font.loadedName !== 'string' || !font.loadedName ||
        typeof glyph.fontChar !== 'string' || !glyph.fontChar) return {reason:unsupported};
      const key = `${font.loadedName}_path_${glyph.fontChar}`;
      if (!paths.has(key)) {
        if (paths.size >= 4096) return {reason:'GLYPH_PATH_KEY_LIMIT'};
        if (!commonObjs.has(key)) return {reason:unsupported};
        const path = commonObjs.get(key)?.path;
        const length = typedLength.call(path);
        const tag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag).get.call(path);
        if (!['Float16Array','Float32Array'].includes(tag)) return {reason:unsupported};
        if (length > 4096) return {reason:'GLYPH_PATH_SCALAR_LIMIT'};
        if ((scalars += length) > 262144) return {reason:'GLYPH_PATH_TOTAL_SCALAR_LIMIT'};
        // Intrinsic length/count checks precede the bounded immutable snapshot.
        const values = Array.from({length},(_,i)=>path[i]);
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,started=false,drawn=false;
        for (let i=0;i<length;) {
          const op = values[i++], arity = [2,2,6,4,0][op];
          if (!Number.isInteger(op) || arity === undefined || i+arity > length ||
            (op !== 0 && !started)) return {reason:unsupported};
          if (op === 0) started = true;
          else if (op !== 4) drawn = true;
          for (let end=i+arity;i<end;i+=2) {
            const px=values[i],py=values[i+1];
            if (!Number.isFinite(px) || !Number.isFinite(py)) return {reason:unsupported};
            minX=Math.min(minX,px);maxX=Math.max(maxX,px);
            minY=Math.min(minY,py);maxY=Math.max(maxY,py);
          }
          // Fill implicitly closes subpaths. PDF.js source glyphs need not put
          // closePath after every move; unknown/truncated commands still refuse.
        }
        paths.set(key,drawn && minX<maxX && minY<maxY?{minX,minY,maxX,maxY}:null);
      }
      const box = paths.get(key);
      if (!box) { if (glyph.isSpace !== true) return {reason:unsupported}; continue; }
      const envelope = {left:x+box.minX*size,right:x+box.maxX*size,
        bottom:y+box.minY*size,top:y+box.maxY*size};
      if (!Object.values(envelope).every(Number.isFinite)) return {reason:unsupported};
      if (envelope.left >= envelope.right || envelope.bottom >= envelope.top) return {reason:unsupported};
      envelopes.push(envelope);
    }
    return {envelopes};
  } catch { return {reason:unsupported}; }
}

function glyphEnvelopeOverlapReason(envelopes) {
  const sorted = [...envelopes].sort((a,b)=>a.bottom-b.bottom);
  let checks = 0;
  for (let i=0;i<sorted.length;i++) {
    const a=sorted[i];
    for (let j=i+1;j<sorted.length && sorted[j].bottom<a.top;j++) {
      if (++checks>65536) return 'GLYPH_ENVELOPE_CHECK_LIMIT';
      const b=sorted[j];
      if (a.left<b.right && b.left<a.right && a.bottom<b.top && b.bottom<a.top)
        return 'OVERLAPPING_GLYPH_ENVELOPE_UNASSESSED';
    }
  }
  return null;
}

function nativeFragment(pdfjs, item, viewport, pageId, fragmentIndex, contentItemIndex) {
  if (typeof item.str !== 'string' || !Number.isFinite(item.width) || item.width <= 0 ||
    !Array.isArray(item.transform) || item.transform.length !== 6 || !item.transform.every(Number.isFinite)) throw new TypeError('Unsupported native geometry');
  const t = pdfjs.Util.transform(viewport.transform, item.transform);
  const baseline = Math.hypot(t[0],t[1]);
  if (!baseline || !Math.hypot(t[2],t[3])) throw new TypeError('Unsupported native geometry');
  // Viewport.scale omits PDF UserUnit; its actual matrix includes both.
  const pixelScale = Math.hypot(viewport.transform[0],viewport.transform[1]);
  const dx = t[0] / baseline * item.width * pixelScale;
  const dy = t[1] / baseline * item.width * pixelScale;
  const corners = [[t[4],t[5]], [t[4]+dx,t[5]+dy], [t[4]+t[2],t[5]+t[3]], [t[4]+dx+t[2],t[5]+dy+t[3]]];
  const x = Math.min(...corners.map(value => value[0])), y = Math.min(...corners.map(value => value[1]));
  const width = Math.max(...corners.map(value => value[0])) - x;
  const height = Math.max(...corners.map(value => value[1])) - y;
  if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x + width > Math.ceil(viewport.width) || y + height > Math.ceil(viewport.height)) throw new RangeError('Native text outside selected frame');
  return { id: `${pageId}-f${fragmentIndex}`, contentItemIndex, pdfTransform: [...item.transform],
    viewportTransform: t, quad: corners, text: item.str, x, y, width, height };
}

function coincidentNativeStart(fragments) {
  // These finite origin points come from already validated nonempty native
  // items. A shared start is uncertain overprinting, not proof of duplication.
  // Page-local exact keys keep this check linear; near/general overlap is not
  // assessed, and neither text nor glyphs are removed or merged.
  const starts = new Set();
  for (const fragment of fragments) {
    const key = JSON.stringify(fragment.quad[0]);
    if (starts.has(key)) return true;
    starts.add(key);
  }
  return false;
}

function nativeOverlapReason(fragments) {
  // Validated native advance boxes are not painted glyph bounds. Strict
  // positive-area intersections conservatively hold; shared edges do not.
  // Sort a copy so native text order and fragment identities are preserved.
  const sorted = [...fragments].sort((a, b) => a.x - b.x);
  let candidates = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i], right = a.x + a.width;
    for (let j = i + 1; j < sorted.length && sorted[j].x < right; j++) {
      // Initial per-page policy bound, not a measured performance guarantee.
      if (++candidates > 65536) return 'NATIVE_OVERLAP_CHECK_LIMIT';
      const b = sorted[j];
      if (a.y < b.y + b.height && b.y < a.y + a.height)
        return 'OVERLAPPING_NATIVE_TEXT_UNASSESSED';
    }
  }
  return null;
}

/**
 * Private Node-only draft intake. All caller data is snapshotted before awaits.
 * Canonical PNG/frame declarations are checked against parsed PDF geometry,
 * not authenticated as a faithful rendering. Native IDs require an independent
 * canonical-fragment crosswalk before corpus scoring. No files/human flags.
 */
export async function createSelectedPageReviewDraft(request) {
  let loadingTask;
  try {
    const snapshot = capture(request);
    if (![37,80,68,70,45].every((value,index) => snapshot.sourceBytes[index] === value)) return abstain('PDF_REQUIRED');
    // Validate all PNG headers before any decoder or PDF page rendering.
    for (const selected of snapshot.selections) {
      const size = pngSize(selected.canonicalImageBytes);
      if (size.width !== selected.frame.width || size.height !== selected.frame.height) return abstain('PNG_FRAME_MISMATCH');
    }
    const pdfjs = await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    // PDF.js may transfer/detach its data; keep the authoring snapshot separate.
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(snapshot.sourceBytes), useSystemFonts: true,
      isEvalSupported: false, stopAtErrors: true });
    const pdf = await loadingTask.promise;
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 512) return abstain('PDF_PAGE_LIMIT');
    const checked = [];
    for (const selected of snapshot.selections) {
      if (selected.identity.physicalPage > pdf.numPages) return abstain('PHYSICAL_PAGE_MISSING');
      const page = await pdf.getPage(selected.identity.physicalPage);
      const viewport = page.getViewport({ scale: selected.frame.scale });
      const frame = selected.frame;
      if (!validRenderDimensions(viewport.width,viewport.height) || !same(page.view,frame.viewBox) ||
        viewport.rotation !== frame.rotation || !same(viewport.transform,frame.transform) ||
        Math.ceil(viewport.width) !== frame.width || Math.ceil(viewport.height) !== frame.height) return abstain('PDF_FRAME_MISMATCH');
      const image = await loadImage(Buffer.from(selected.canonicalImageBytes));
      if (image.width !== frame.width || image.height !== frame.height) return abstain('DECODED_PNG_FRAME_MISMATCH');
      // Check every selection before native extraction, proposal or rendering.
      const operators = await page.getOperatorList();
      if (operators.fnArray.length > 100000) return abstain('PAGE_OPERATOR_LIMIT');
      const visibilityReason = nativeVisibilityReason(pdfjs.OPS, operators, page.commonObjs);
      if (visibilityReason) return abstain(visibilityReason);
      checked.push({ selected, page, viewport, operators });
    }
    // Validate selected native items before any proposal or preview, including
    // when a later selection has uncertain overprinting or invalid geometry.
    const nativeChecked = [];
    for (let index = 0; index < checked.length; index++) {
      const { selected, page, viewport, operators } = checked[index], pageId = `p${index+1}`;
      const content = await page.getTextContent();
      if (content.items.length > 32768) return abstain('NATIVE_ITEM_LIMIT');
      const nativeFragments = [];
      for (let itemIndex = 0; itemIndex < content.items.length; itemIndex++) {
        const item = content.items[itemIndex];
        if (!item.str?.trim()) continue;
        if (item.dir === 'ttb' || content.styles[item.fontName]?.vertical) return abstain('UNSUPPORTED_VERTICAL_TEXT');
        if (nativeFragments.length >= 8192) return abstain('NATIVE_FRAGMENT_LIMIT');
        nativeFragments.push(nativeFragment(pdfjs,item,viewport,pageId,nativeFragments.length,itemIndex));
      }
      if (JSON.stringify(nativeFragments).length > 262144) return abstain('NATIVE_PAYLOAD_LIMIT');
      if (coincidentNativeStart(nativeFragments)) return abstain('COINCIDENT_NATIVE_TEXT_UNASSESSED');
      const overlapReason = nativeOverlapReason(nativeFragments);
      if (overlapReason) return abstain(overlapReason);
      const hasImages = pageHasRasterImages(pdfjs.OPS,operators.fnArray);
      const fragments = nativeFragments.map(({ text,x,y,width,height }) => ({ text,x,y,width,height }));
      const record = { width: selected.frame.width, height: selected.frame.height, fragments, hasImages, ocrText: '' };
      nativeChecked.push({ selected, page, viewport, pageId, nativeFragments, record });
    }
    // Existing operator/native refusal priority applies to every selection.
    const glyphChecked = [];
    for (const {page,operators} of checked) {
      const placements = [];
      const reason = operatorTextRunReason(pdfjs,operators,page.commonObjs,placements);
      if (reason) return abstain(reason);
      glyphChecked.push({placements,commonObjs:page.commonObjs});
    }
    // All new metrics and policy caps precede pair work across all selections.
    const envelopesChecked = [];
    for (const {placements,commonObjs} of glyphChecked) {
      const checkedPaths = glyphEnvelopes(placements,commonObjs);
      if (checkedPaths.reason) return abstain(checkedPaths.reason);
      envelopesChecked.push(checkedPaths.envelopes);
    }
    for (const envelopes of envelopesChecked) {
      const reason = glyphEnvelopeOverlapReason(envelopes);
      if (reason) return abstain(reason);
    }
    const pages = [], proposals = [];
    for (let index = 0; index < nativeChecked.length; index++) {
      const { selected, page, viewport, pageId, nativeFragments, record } = nativeChecked[index];
      const proposal = proposePageStructure({ ...record, pageIndex: index });
      if (proposal.regions.length > 256 || proposal.edges.length > 1024 || JSON.stringify(proposal).length > 262144)
        return abstain('PROPOSED_GRAPH_LIMIT');
      const canvas = pdf.canvasFactory.create(record.width,record.height);
      let previewPngBytes;
      try {
        await page.render({ canvasContext: canvas.context, viewport }).promise;
        previewPngBytes = bytes(new Uint8Array(canvas.canvas.toBuffer('image/png')));
      } finally { pdf.canvasFactory.destroy(canvas); }
      proposals.push(proposal);
      pages.push({ ...selected, pageId, pdfUserUnit: page.userUnit, record, nativeFragments, previewPngBytes,
        previewSha256: hash(previewPngBytes), sourceRenderEquivalence: 'unverified', canonicalFragmentCrosswalk: 'unavailable' });
    }
    return { status: 'DRAFT', sourceBytes: snapshot.sourceBytes, sourcePageCount: pdf.numPages,
      renderer: { name: 'pdfjs-dist', version: pdfjs.version, fragmentIds: 'pdfjs-native-items-local-v1' },
      pages, document: createDocumentStructure(proposals),
      manualReview: { eventCapture: 'unavailable', editCount: null, durationSeconds: null } };
  } catch {
    return abstain('INVALID_SELECTED_PAGE_INPUT_OR_RENDER');
  } finally { await loadingTask?.destroy().catch(() => {}); }
}
