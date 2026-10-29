import { assessRasterRegion } from './document-raster-regions.mjs';
import { isTableReferenceText } from './document-table-grid.mjs';

const finitePositive = n => Number.isFinite(n) && n > 0;
const near = (a, b) => Math.abs(a - b) <= .5;
const numeric = text => /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(text);
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;

/** Source-position scaffold only. Empty VALUE slots deliberately fail review
 * validation: source rules cannot establish whether a position is blank/merged.
 * No reference grid, semantic spans, or visibility certification enters here. */
export function proposeRuleTableScaffold(input = {}) {
  // Existing accepted compact drafts take precedence over every fallback check.
  return proposeWithRuleWindow(input, false) ?? proposeWithRuleWindow(input, true);
}

function proposeWithRuleWindow({ lines, fragments, width, height, pageId, ruleHints, rasterHints } = {}, missingBottomOnly = false) {
  if (![width, height].every(finitePositive) || typeof pageId !== 'string' || !pageId ||
      !Array.isArray(lines) || !lines.length || lines.length > 1000 ||
      !Array.isArray(fragments) || fragments.length > 10000 ||
      ruleHints?.version !== 'pdfjs-horizontal-rule-evidence-v1' || ruleHints.width !== width ||
      ruleHints.height !== height || !Array.isArray(ruleHints.candidates) || ruleHints.candidates.length > 256) return null;
  const visible = [];
  for (const [id, p] of fragments.entries()) {
    if (!p || typeof p.text !== 'string') return null;
    if (!p.text.trim()) continue;
    if (![p.x,p.y,p.width,p.height].every(Number.isFinite) || !finitePositive(p.width) || !finitePositive(p.height) ||
        p.x < 0 || p.y < 0 || p.x+p.width > width || p.y+p.height > height) return null;
    visible.push({ ...p, id });
  }
  const owned = new Set(), body = [], captions = [];
  let captionSeen = false;
  for (const line of lines) {
    if (!line || typeof line.text !== 'string' || !Array.isArray(line.fragmentIds) || line.fragmentIds.length > fragments.length) return null;
    const caption = /^\s*TABLE\s+\d+\b/i.test(line.text);
    if (caption && (body.length || captionSeen || isTableReferenceText(line.text))) return null;
    if (caption) captionSeen = true;
    for (const id of line.fragmentIds) {
      if (!Number.isInteger(id) || id < 0 || id >= fragments.length || owned.has(id) || !fragments[id]?.text?.trim()) return null;
      owned.add(id);
      (caption ? captions : body).push({ ...fragments[id], id });
    }
  }
  if (!captionSeen || body.length < 6 || body.length > 400) return null;
  body.sort((a,b) => a.y-b.y || a.x-b.x);
  const rows = [];
  for (const p of body) {
    const row = rows.at(-1);
    if (row && near(row[0].y,p.y)) row.push(p); else rows.push([p]);
  }
  if (rows.length < 3 || rows.length > 20) return null;
  for (const [r,row] of rows.entries()) {
    row.sort((a,b)=>a.x-b.x);
    if (row.some(p=>!near(p.height,row[0].height))) return null;
    if (r && Math.min(...row.map(p=>p.y)) < Math.max(...rows[r-1].map(p=>p.y+p.height))-.5) return null;
    if (row.some((p,i)=>i && p.x < row[i-1].x+row[i-1].width-.5)) return null;
  }
  const firstY = rows[0][0].y, lastEnd = Math.max(...rows.at(-1).map(p=>p.y+p.height));
  const maxHeight = Math.max(...body.map(p=>p.height));
  let searchEnd = lastEnd + maxHeight*2;
  if (missingBottomOnly) {
    // Only sustained BODY spacing supports the prospective missing closure.
    // Header/caption transitions and a single gap provide no cadence evidence.
    if (rows.length < 4 || body.some(p=>p.height !== maxHeight)) return null;
    const dataRows = rows.slice(1);
    const clearance = (previous, next) => Math.min(...next.map(p=>p.y)) -
      Math.max(...previous.map(p=>p.y+p.height));
    const gap = clearance(dataRows[0], dataRows[1]);
    if (!Number.isFinite(gap) || !(gap > maxHeight*2) ||
        dataRows.slice(2).some((row,i)=>clearance(dataRows[i+1],row) !== gap)) return null;
    searchEnd = lastEnd + gap;
    if (!Number.isFinite(searchEnd)) return null;
  }
  const left = Math.min(...body.map(p=>p.x)), right = Math.max(...body.map(p=>p.x+p.width));
  const bands = [];
  for (const c of ruleHints.candidates) {
    const l=c?.line;
    if (!l || ![l.x1,l.x2,l.y1,l.y2].every(Number.isFinite) || !(l.x2>l.x1) || !near(l.y1,l.y2) ||
        c.status!=='unverified' || c.occlusion!=='unknown' || !Number.isInteger(c.operatorIndex) ||
        !c.box || ![c.box.x,c.box.y,c.box.width,c.box.height].every(Number.isFinite) ||
        !finitePositive(c.box.width) || !finitePositive(c.box.height) ||
        !near(c.box.x,l.x1) || !near(c.box.width,l.x2-l.x1) || !near(c.box.y+c.box.height/2,l.y1) ||
        c.box.x<0 || c.box.y<0 || c.box.x+c.box.width>width || c.box.y+c.box.height>height) return null;
    if (l.y1 < firstY-maxHeight*2 || l.y1 > searchEnd || l.x2 < left || l.x1 > right) continue;
    if ([...body,...captions].some(p=>intersects(p,c.box))) return null;
    let band=bands.find(b=>near(b.y,l.y1));
    if (!band) bands.push(band={y:l.y1,segments:[]});
    band.segments.push(l);
  }
  bands.sort((a,b)=>a.y-b.y);
  if (bands.length!==3) return null;
  for (const b of bands) b.segments.sort((a,b)=>a.x1-b.x1);
  const partitions=bands[0].segments, columns=partitions.length;
  // The old compact scope must already contain exactly the top and separator;
  // every expanded-scope band remains present for the ordinary three-band gate.
  if (missingBottomOnly && (columns !== 2 ||
      bands.slice(0,2).some(b=>b.segments.some(l=>l.y1 > lastEnd+maxHeight*2)) ||
      bands[2].segments.some(l=>l.y1 <= lastEnd+maxHeight*2))) return null;
  if (columns<2 || columns>20 || (columns>=3 && body.length<7) ||
      bands.some(b=>b.segments.length!==columns)) return null;
  for (const b of bands) for (let c=0;c<columns;c++) {
    const l=b.segments[c], reference=partitions[c];
    if (!near(l.x1,reference.x1) || !near(l.x2,reference.x2) || (c && !near(l.x1,b.segments[c-1].x2))) return null;
  }
  const [top,separator,bottom]=bands.map(b=>b.y);
  if (!(top < firstY && separator > Math.max(...rows[0].map(p=>p.y+p.height)) &&
      separator < rows[1][0].y && bottom > lastEnd)) return null;
  const box={x:partitions[0].x1,y:top,width:partitions.at(-1).x2-partitions[0].x1,height:bottom-top};
  if (box.x<0 || box.y<0 || box.x+box.width>width || box.y+box.height>height ||
      assessRasterRegion(rasterHints,box).status!=='raster-disjoint') return null;
  if (captions.some(p=>p.y+p.height>=top || p.x<box.x-.5 || p.x+p.width>box.x+box.width+.5)) return null;
  // An omitted/intervening source fragment invalidates the whole scaffold.
  if (visible.some(p=>intersects(p,box) && !body.some(b=>b.id===p.id))) return null;
  const grid=rows.map(()=>Array.from({length:columns},()=>[]));
  for (const [r,row] of rows.entries()) for (const p of row) {
    const c=partitions.findIndex(l=>p.x>=l.x1-.5 && p.x+p.width<=l.x2+.5);
    if (c<0 || p.y<top || p.y+p.height>bottom || (r===0 ? p.y+p.height>=separator : p.y<=separator)) return null;
    grid[r][c].push(p);
  }
  // Paint segments are only potential partitions; native starts must corroborate
  // each one in more than a single row. Wrapped/header spans remain unsupported.
  if (partitions.some((l,c)=>grid.filter(row=>row[c].length && near(row[c][0].x,l.x1)).length<2)) return null;
  const text=ps=>ps.reduce((value,p,i)=>{
    const previous=ps[i-1],gap=previous?p.x-previous.x-previous.width:0;
    return value+(i && gap>Math.max(1,p.height*.12) && !/\s$/.test(value) && !/^\s/.test(p.text)?' ':'')+p.text;
  },'').trim();
  if (grid[0].filter(ps=>ps.length).length<2 || grid[0].some(ps=>ps.length && !/\p{L}/u.test(text(ps)))) return null;
  if (columns===2) {
    // A two-column draft needs every explicit position. Missing labels cannot
    // establish a row group, blank value, or merged header from paint alone.
    if (grid.some(row=>row.some(ps=>!ps.length))) return null;
    for (const row of grid.slice(1)) if (!/^\p{L}/u.test(text(row[0])) ||
        !numeric(text(row[1]))) return null;
  } else {
    for (const row of grid.slice(1)) if (row.filter(ps=>numeric(text(ps))).length<2) return null;
  }
  const headers = grid[0].map((ps,c)=>ps.length?`c1-${c+1}`:null);
  const cells=grid.flatMap((row,r)=>{
    const firstNumeric=row.findIndex(ps=>numeric(text(ps)));
    const rowHeaders=row.map((ps,c)=>r && c<firstNumeric && /\p{L}/u.test(text(ps))?`c${r+1}-${c+1}`:null).filter(Boolean);
    return row.map((ps,c)=>{
      const id=`c${r+1}-${c+1}`, value=text(ps), role=value && (!r || rowHeaders.includes(id))?'header':'value';
      return {id,row:r,column:c,rowSpan:1,colSpan:1,text:value,role,
        headerCellIds:r && value?[...(headers[c]?[headers[c]]:[]),...(role==='value'?rowHeaders:[])]:[],
        sourceFragmentIds:ps.map(p=>`${pageId}-f${p.id}`)};
    });
  });
  return {table:{rowCount:rows.length,columnCount:columns,cells,reviewed:false,scaffold:true},box};
}
