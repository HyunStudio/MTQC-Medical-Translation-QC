// Pinned PDF.js paint-operation evidence only. These are NOT verified panels:
// later paint/occlusion, document semantics and text ownership remain unknown.
const EPS = 1e-4;
const numericArray = a => Array.isArray(a) || (ArrayBuffer.isView(a) && typeof a.BYTES_PER_ELEMENT === 'number');
const numbers = (a, n) => numericArray(a) && a.length === n && [...a].every(Number.isFinite);
const positiveAxis = m => numbers(m, 6) && m[0] > 0 && m[3] > 0 && m[1] === 0 && m[2] === 0;
const validBox = box => [box.x,box.y,box.width,box.height].every(Number.isFinite) && box.width > 0 && box.height > 0 &&
  box.x + box.width > box.x && box.y + box.height > box.y;
const contains = (a, b) => b.x >= a.x - EPS && b.y >= a.y - EPS &&
  b.x + b.width <= a.x + a.width + EPS && b.y + b.height <= a.y + a.height + EPS;

function rectanglePath(data, bounds) {
  if (!Array.isArray(data) || data.length !== 1 || !numbers(bounds, 4)) return null;
  const path = data[0];
  if (!numericArray(path) || path.length > 256 || ![...path].every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = bounds, w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  // Absolute source tolerances can turn a thin triangle into a rectangle,
  // then become a large visible error under anisotropic scaling.
  const tolerance = Math.min(EPS, Math.min(w,h) * 1e-8);
  const close = (a,b) => Math.abs(a-b) <= tolerance;
  const inside = p => p[0] >= x0 - tolerance && p[0] <= x1 + tolerance && p[1] >= y0 - tolerance && p[1] <= y1 + tolerance;
  const boundaryLine = (a, b) =>
    (close(a[0], b[0]) && (close(a[0], x0) || close(a[0], x1))) ||
    (close(a[1], b[1]) && (close(a[1], y0) || close(a[1], y1)));
  const between = (p, a, b) => boundaryLine(a, b) &&
    p[0] >= Math.min(a[0], b[0]) - tolerance && p[0] <= Math.max(a[0], b[0]) + tolerance &&
    p[1] >= Math.min(a[1], b[1]) - tolerance && p[1] <= Math.max(a[1], b[1]) + tolerance &&
    (close(a[0], b[0]) ? close(p[0], a[0]) : close(p[1], a[1]));
  const vertices = [], allPoints = [];
  let current, first, ended = false, curved = false;
  for (let i = 0; i < path.length;) {
    const op = path[i++];
    if (ended) return null;
    if (op === 0) {
      if (current || i + 2 > path.length) return null;
      first = current = [path[i++], path[i++]];
      vertices.push(first); allPoints.push(first);
    } else if (op === 1) {
      if (!current || i + 2 > path.length) return null;
      const end = [path[i++], path[i++]];
      if (!boundaryLine(current, end)) return null;
      vertices.push(end); allPoints.push(end); current = end;
    } else if (op === 2) {
      if (!current || i + 6 > path.length) return null;
      const c1 = [path[i++], path[i++]], c2 = [path[i++], path[i++]], end = [path[i++], path[i++]];
      // Replace a small monotone corner by its sharp corner for perimeter
      // validation. Arbitrary bezier shapes and interior curves are not boxes.
      const corners = [[x0,y0],[x0,y1],[x1,y0],[x1,y1]].filter(corner => {
        const dx = Math.abs(current[0] - corner[0]) + Math.abs(current[1] - corner[1]);
        const dy = Math.abs(end[0] - corner[0]) + Math.abs(end[1] - corner[1]);
        return dx > tolerance && dy > tolerance && dx <= Math.min(w,h) * .25 + tolerance && dy <= Math.min(w,h) * .25 + tolerance &&
          boundaryLine(current, corner) && boundaryLine(corner, end) && !boundaryLine(current, end) &&
          between(c1, current, corner) && between(c2, corner, end);
      });
      if (corners.length !== 1) return null;
      vertices.push(corners[0], end); allPoints.push(c1, c2, end); current = end; curved = true;
    } else if (op === 4) {
      if (!current || !boundaryLine(current, first)) return null;
      vertices.push(first); ended = true;
    } else return null;
  }
  if (!ended || !allPoints.every(inside)) return null;
  const actual = [Math.min(...allPoints.map(p=>p[0])),Math.min(...allPoints.map(p=>p[1])),
    Math.max(...allPoints.map(p=>p[0])),Math.max(...allPoints.map(p=>p[1]))];
  if (!actual.every((n,i)=>close(n,bounds[i]))) return null;
  let length = 0, area = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i-1], b = vertices[i];
    length += Math.abs((a[0]-b[0])/w) + Math.abs((a[1]-b[1])/h);
    area += ((a[0]-x0)/w)*((b[1]-y0)/h) - ((b[0]-x0)/w)*((a[1]-y0)/h);
  }
  // The expanded outline must trace the complete perimeter exactly once.
  if (Math.abs(length-4) > 1e-8 || Math.abs(Math.abs(area)/2-1) > 1e-8) return null;
  return { bounds: [...bounds], kind: curved ? 'rounded-rectangle' : 'rectangle' };
}

function viewportBox(bounds, matrix, view) {
  const [x0,y0,x1,y1] = bounds;
  const xs = [x0,x1].map(x=>(matrix[0]*x+matrix[4])*view[0]+view[4]);
  const ys = [y0,y1].map(y=>(matrix[3]*y+matrix[5])*view[3]+view[5]);
  return {x:Math.min(...xs),y:Math.min(...ys),width:Math.abs(xs[1]-xs[0]),height:Math.abs(ys[1]-ys[0])};
}

const ignored = new Set(('dependency setLineWidth setLineCap setLineJoin setMiterLimit setDash setRenderingIntent setFlatness '+
  'setStrokeRGBColor setStrokeTransparent setStrokeColor setStrokeColorN setStrokeGray setStrokeCMYKColor '+
  'beginText endText setCharSpacing setWordSpacing setHScale setLeading setFont setTextRise moveText '+
  'setLeadingMoveText setTextMatrix nextLine showText showSpacedText nextLineShowText nextLineSetSpacingShowText '+
  'markPoint markPointProps beginMarkedContent paintImageXObject paintInlineImageXObject paintImageMaskXObject '+
  'paintSolidColorImageMask paintImageXObjectRepeat paintImageMaskXObjectRepeat paintImageMaskXObjectGroup '+
  'paintInlineImageXObjectGroup').split(' '));

/** No classification or fragment reordering is performed by this collector. */
export function collectFilledRectangles({OPS,operatorList,viewport,pdfjsVersion} = {}) {
  const fail = reason => ({version:'pdfjs-rect-evidence-v1',candidates:[],unsupported:[reason]});
  if (pdfjsVersion !== '6.3.289') return fail('unsupported-pdfjs-version');
  if (!viewport || !numbers(viewport.transform,6) || !(viewport.width > 0 && viewport.height > 0) ||
    !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
    viewport.transform[0] <= 0 || viewport.transform[3] >= 0 || viewport.transform[1] !== 0 || viewport.transform[2] !== 0)
    return fail('unsupported-viewport');
  if (!OPS || !operatorList || !Array.isArray(operatorList.fnArray) || !Array.isArray(operatorList.argsArray) ||
    operatorList.fnArray.length !== operatorList.argsArray.length || operatorList.fnArray.length > 100000)
    return fail('invalid-operator-list');
  const names = new Map(Object.entries(OPS).filter(([,value])=>Number.isInteger(value)).map(([name,value])=>[value,name]));
  const scopeOps = new Set(['beginGroup','endGroup','paintFormXObjectBegin','paintFormXObjectEnd','beginAnnotation','endAnnotation']);
  const pageBox = {x:0,y:0,width:viewport.width,height:viewport.height};
  let state = {matrix:[1,0,0,1,0,0],fill:'#000000',alpha:1,blend:'source-over',mask:false,transfer:false,
    known:true,clip:pageBox}, pendingClip = false, marked = 0;
  const stack = [], candidates = [], unsupported = [];
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const name = names.get(operatorList.fnArray[index]), args = operatorList.argsArray[index];
    if (!name) return fail('unknown-operator');
    if (scopeOps.has(name)) return fail('unsupported-resource-scope');
    if (name === 'save') stack.push({...state,matrix:[...state.matrix]});
    else if (name === 'restore') {
      if (!stack.length) return fail('unbalanced-graphics-state');
      state = stack.pop();
    } else if (name === 'transform') {
      if (!positiveAxis(args)) state.known = false;
      else {
        state.matrix = [state.matrix[0]*args[0],0,0,state.matrix[3]*args[3],
          state.matrix[0]*args[4]+state.matrix[4],state.matrix[3]*args[5]+state.matrix[5]];
        if (!positiveAxis(state.matrix)) state.known = false;
      }
    } else if (name === 'setFillRGBColor') state.fill = typeof args?.[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0]) ? args[0].toLowerCase() : null;
    else if (['setFillTransparent','setFillColorN','setFillColor','setFillGray','setFillCMYKColor','setFillColorSpace'].includes(name)) state.fill = null;
    else if (name === 'setGState') {
      if (!Array.isArray(args?.[0])) return fail('invalid-graphics-state');
      for (const entry of args[0]) {
        if (!Array.isArray(entry) || entry.length !== 2) return fail('invalid-graphics-state');
        const [key,value] = entry;
        if (key === 'ca') state.alpha = value;
        else if (key === 'BM') state.blend = value;
        else if (key === 'SMask') state.mask = value !== false;
        else if (key === 'TR') state.transfer = value !== null;
        else if (!['CA','LW','LC','LJ','ML','D','RI','FL','Font'].includes(key)) state.known = false;
      }
    } else if (name === 'clip' || name === 'eoClip') pendingClip = true;
    else if (name === 'constructPath') {
      const shape = rectanglePath(args?.[1],args?.[2]);
      const projected = shape && state.known && viewportBox(shape.bounds,state.matrix,viewport.transform);
      const box = projected && validBox(projected) ? projected : null;
      if (pendingClip) {
        // A known rectangle can only relax uncertainty if its current clip is
        // known. Keep partial clips for candidate containment, never enlarge.
        if (args?.[0] !== OPS.endPath || shape?.kind !== 'rectangle' || !box || !state.clip) state.clip = null;
        else {
          const x=Math.max(box.x,state.clip.x),y=Math.max(box.y,state.clip.y);
          state.clip = {x,y,width:Math.max(0,Math.min(box.x+box.width,state.clip.x+state.clip.width)-x),
            height:Math.max(0,Math.min(box.y+box.height,state.clip.y+state.clip.height)-y)};
        }
        pendingClip = false;
      } else if (args?.[0] === OPS.fill && shape && box && state.clip && state.fill && state.alpha === 1 &&
        state.blend === 'source-over' && !state.mask && !state.transfer && contains(state.clip,box) && contains(pageBox,box)) {
        if (candidates.length >= 256) return fail('candidate-limit');
        candidates.push({operatorIndex:index,box,fill:state.fill,kind:shape.kind,status:'unverified',occlusion:'unknown'});
      } else if (args?.[0] === OPS.fill) unsupported.push(index);
    } else if (name === 'beginMarkedContentProps') {
      if (!Array.isArray(args) || args[0] === 'OC' || args[1] != null) return fail('unsupported-optional-content');
      marked++;
    } else if (name === 'beginMarkedContent') marked++;
    else if (name === 'endMarkedContent') { if (!marked--) return fail('unbalanced-marked-content'); }
    else if (name === 'setTextRenderingMode') { if (!Number.isInteger(args?.[0]) || args[0] < 0 || args[0] > 3) return fail('unsupported-text-clip'); }
    else if (!ignored.has(name)) return fail('unsupported-operator');
  }
  if (stack.length || marked || pendingClip) return fail('unbalanced-source-state');
  return {version:'pdfjs-rect-evidence-v1',candidates,unsupported};
}
