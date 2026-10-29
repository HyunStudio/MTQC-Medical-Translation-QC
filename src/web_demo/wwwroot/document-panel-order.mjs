// A narrow, unverified draft for question panels with named glossary insets.
// Paint shapes are source clues, not visibility or semantic verification.
const validBox = b => b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
const contains = (a,b) => b.x >= a.x-.001 && b.y >= a.y-.001 &&
  b.x+b.width <= a.x+a.width+.001 && b.y+b.height <= a.y+a.height+.001;
const intersects = (a,b) => Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x) > .001 &&
  Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y) > .001;

export function partitionQuestionPanels(fragments,pageWidth,hints) {
  if (!hints || hints.version !== 'pdfjs-rect-evidence-v1' || hints.hasImages !== false ||
    hints.width !== pageWidth || !Number.isFinite(hints.height) || hints.height <= 0 ||
    !Array.isArray(hints.candidates) || hints.candidates.length < 4 || hints.candidates.length > 12) return null;
  const page={x:0,y:0,width:pageWidth,height:hints.height}, candidates=hints.candidates;
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || candidates.some(c=>!validBox(c?.box) || !contains(page,c.box) ||
    c.status !== 'unverified' || c.occlusion !== 'unknown' || !Number.isInteger(c.operatorIndex) || c.operatorIndex < 0 ||
    !['rectangle','rounded-rectangle'].includes(c.kind) || !/^#[a-f0-9]{6}$/.test(c.fill))) return null;
  if (new Set(candidates.map(c=>c.operatorIndex)).size !== candidates.length) return null;
  const panels=candidates.filter(c=>c.kind==='rectangle' && c.fill!=='#ffffff' &&
    c.box.width>=pageWidth*.7 && c.box.height>=hints.height*.12).sort((a,b)=>a.box.y-b.box.y);
  if (panels.length < 2 || panels.some((p,i)=>p.fill!==panels[0].fill ||
    (i && panels[i-1].box.y+panels[i-1].box.height > p.box.y))) return null;
  const insets=panels.map(panel=>candidates.filter(c=>c!==panel && c.kind==='rounded-rectangle' && c.fill==='#ffffff' &&
    contains(panel.box,c.box) && c.box.width<panel.box.width*.55 && c.box.height<panel.box.height*.95));
  if (insets.some(a=>a.length!==1)) return null;
  const assignedShapes=new Set([...panels,...insets.flat()]);
  if (assignedShapes.size!==candidates.length) return null;
  const items=[];
  for (let i=0;i<fragments.length;i++) {
    const item=fragments[i];
    if (typeof item?.text !== 'string') return null;
    if (!item.text.trim()) continue;
    if (!validBox(item) || !contains(page,item)) return null;
    items.push({...item,fragmentId:i});
  }
  const groups=panels.map(()=>({main:[],aside:[]})), outside=[];
  for (const item of items) {
    const owners=panels.flatMap((p,i)=>contains(p.box,item)?[i]:[]);
    if (owners.length>1) return null;
    if (!owners.length) {
      // Horizontally separate text concurrent with a panel has no established
      // placement relative to that panel; don't guess its reading band.
      if (panels.some(p=>item.y<p.box.y+p.box.height && item.y+item.height>p.box.y)) return null;
      outside.push(item); continue;
    }
    const owner=owners[0], inset=insets[owner][0].box;
    if (contains(inset,item)) groups[owner].aside.push(item);
    else if (intersects(inset,item)) return null;
    else groups[owner].main.push(item);
  }
  for (let i=0;i<groups.length;i++) {
    const {main,aside}=groups[i], panel=panels[i].box, inset=insets[i][0].box;
    const first=[...main].sort((a,b)=>a.y-b.y||a.x-b.x)[0];
    if (!first || first.y-panel.y>40 || !/^(?:What|How|Why|Who|When|Where|Which)\b.{2,110}\?$/i.test(first.text.trim())) return null;
    if (main.filter(item=>item.width>pageWidth*.12 && item.text.trim().split(/\s+/).length>=6).length<4) return null;
    const headings=aside.filter(item=>item.text.trim()==='Glossary of terms');
    if (headings.length!==1 || headings[0].y-inset.y>40 || aside.length<4) return null;
    if ([...main,...aside].some(item=>/\b(?:Table|Figure|Fig\.|Equation)|[=∑∫ψασ\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/iu.test(item.text))) return null;
  }
  const segments=[];
  let rest=outside;
  panels.forEach((panel,i)=>{
    const before=rest.filter(item=>item.y+item.height<=panel.box.y);
    rest=rest.filter(item=>!before.includes(item));
    if (before.length) segments.push({items:before,role:'outside'});
    segments.push({items:groups[i].main,role:'main',panel:i},{items:groups[i].aside,role:'glossary',panel:i});
  });
  if (rest.length) segments.push({items:rest,role:'outside'});
  const ids=segments.flatMap(s=>s.items.map(item=>item.fragmentId));
  if (ids.length!==items.length || new Set(ids).size!==items.length) return null;
  return {segments,panels:panels.length,status:'unverified',occlusion:'unknown'};
}
