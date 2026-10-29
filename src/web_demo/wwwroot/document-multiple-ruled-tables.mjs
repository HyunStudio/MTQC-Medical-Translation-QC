import {getRegionalRuleSourceEvidence} from './document-horizontal-rules.mjs';
import {ruleMetadataStamp} from './document-raster-regions.mjs';
import {isTableReferenceText} from './document-table-grid.mjs';

const valid=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
const inside=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const touch=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function bands(items,vertical) {
 const groups=[];
 for(const item of [...items].sort((a,b)=>vertical?a.line.x1-b.line.x1:a.line.y1-b.line.y1)) {
  const low=vertical?item.box.x:item.box.y,high=low+(vertical?item.box.width:item.box.height),last=groups.at(-1);
  if(last&&low<=last.high&&high>=last.low){last.low=Math.max(last.low,low);last.high=Math.min(last.high,high);last.items.push(item);last.at=(last.low+last.high)/2;}
  else groups.push({low,high,at:vertical?item.line.x1:item.line.y1,items:[item]});
 }
 return groups;
}

/** Opt-in unresolved geometry drafts. Never restores source-custody from copies. */
export function proposeMultipleRuledTables(input={}) {
 return analyzeMultipleRuledTables(input).drafts;
}
// Fixed executed phases only: no source literals, coordinates or exception text.
// These attempts describe this invocation and confer no source/review authority.
export function analyzeMultipleRuledTables(input={}) {
 const attempts=[],trace={phase:'input',active:null,overflow:false};
 trace.begin=()=>{if(attempts.length>=32){trace.overflow=true;trace.active=null;return null;}const entry={outcome:'null',phase:trace.phase};attempts.push(entry);trace.active=entry;return entry;};
 let drafts=[];
 try{drafts=propose(input,trace);}catch{if(!trace.active)trace.begin();if(trace.active)trace.active.outcome='caught';}
 if(!attempts.length)trace.begin();
 return {drafts,attempts:Object.freeze(attempts.map(a=>Object.freeze(a))),overflow:trace.overflow};
}
function propose({lines,fragments,width,height,pageId,ruleHints,verticalRuleHints,rasterHints,regionalRasterHints},trace) {
 const phase=name=>{trace.phase=name;if(trace.active)trace.active.phase=name;};
 if(![width,height].every(n=>Number.isFinite(n)&&n>0)||typeof pageId!=='string'||!pageId||pageId.length>128||
   !Array.isArray(lines)||!lines.length||lines.length>2000||!Array.isArray(fragments)||fragments.length>10000||
   ruleMetadataStamp([ruleHints,verticalRuleHints])===null)return [];
 const page={x:0,y:0,width,height},selected=new Set(),captions=[],native=[];
 phase('native');
 for(const [id,p]of fragments.entries()) {
  if(!p||typeof p.text!=='string')return [];
  if(!p.text.trim())continue;
  if(!valid(p)||!inside(page,p))return [];
  native.push({...p,id});
 }
 for(const line of lines) {
  if(!line||typeof line.text!=='string'||!Array.isArray(line.fragmentIds)||!line.fragmentIds.length)return [];
  for(const id of line.fragmentIds){if(!Number.isSafeInteger(id)||id<0||id>=fragments.length||!fragments[id].text.trim()||selected.has(id))return [];selected.add(id);}
  const literal=line.fragmentIds.map(id=>fragments[id].text).join(' ');
  if(/^\s*TABLE\s+\d+\b/i.test(literal)&&!isTableReferenceText(literal))captions.push(line);
 }
 phase('profile');const rejected=[];
 const candidates=(hint,version,vertical)=>{
  if(hint?.version!==version||hint.width!==width||hint.height!==height||!Array.isArray(hint.candidates)||hint.candidates.length>1024)throw 0;
  return hint.candidates.filter(p=>{
   const l=p?.line,b=p?.box;
   if(!l||![l.x1,l.y1,l.x2,l.y2].every(Number.isFinite)||!valid(b)||!inside(page,b)||p.status!=='unverified'||p.occlusion!=='unknown'||
     !Number.isSafeInteger(p.operatorIndex)||p.operatorIndex<0||!/^#[0-9a-f]{6}$/i.test(p.stroke))throw 0;
   if(vertical?(l.x1!==l.x2||l.y2<=l.y1||b.y!==l.y1||b.height!==l.y2-l.y1||b.x+b.width/2!==l.x1):
      (l.y1!==l.y2||l.x2<=l.x1||b.x!==l.x1||b.width!==l.x2-l.x1||b.y+b.height/2!==l.y1))throw 0;
   const okay=(vertical?b.width:b.height)<=2&&p.stroke.toLowerCase()!=='#ffffff';
   if(!okay)rejected.push(p);return okay;
  });
 };
 const h=candidates(ruleHints,'pdfjs-horizontal-rule-evidence-v1',false),v=candidates(verticalRuleHints,'pdfjs-vertical-rule-evidence-v1',true);
 const all=[...h,...v],parents=all.map((_,i)=>i);let work=0;
 const charge=()=>{if(++work>2000000)throw 0;};
 const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let i=0;i<all.length;i++)for(let j=0;j<i;j++){charge();if(touch(all[i].box,all[j].box))parents[find(i)]=find(j);}
 const components=new Map();all.forEach((p,i)=>{const key=find(i);if(!components.has(key))components.set(key,[]);components.get(key).push(p);});
 const drafts=[],draftAttempts=new Map();phase('topology');
 for(const component of components.values()) {
  const localH=component.filter(p=>p.line.y1===p.line.y2),localV=component.filter(p=>p.line.x1===p.line.x2);
  if(localH.length<2||localV.length<2)continue;
  trace.active=null;phase('topology');const attempt=trace.begin();
  const xs=bands(localV,true),ys=bands(localH,false),rows=ys.length-1,cols=xs.length-1;
  if(rows<2||cols<2||rows>128||cols>64||rows*cols>4096)continue;
  const box={x:xs[0].at,y:ys[0].at,width:xs.at(-1).at-xs[0].at,height:ys.at(-1).at-ys[0].at};
  if(!valid(box))continue;
  const px=Math.min(...component.map(p=>p.box.x)),py=Math.min(...component.map(p=>p.box.y));
  const painted={x:px,y:py,width:Math.max(...component.map(p=>p.box.x+p.box.width))-px,height:Math.max(...component.map(p=>p.box.y+p.box.height))-py};
  if(rejected.some(p=>touch(p.box,painted)))continue;
  phase('caption');const captionMatches=captions.filter(cap=>{
   const parts=cap.fragmentIds.map(i=>fragments[i]),bottom=Math.max(...parts.map(p=>p.y+p.height));
   return parts.every(p=>p.x>=painted.x&&p.x+p.width<=painted.x+painted.width)&&bottom<=painted.y&&painted.y-bottom<=4*Math.max(...parts.map(p=>p.height));
  });
  if(captionMatches.length!==1)continue;
  phase('source-custody');const regional=getRegionalRuleSourceEvidence(ruleHints,verticalRuleHints,regionalRasterHints??rasterHints,painted);
  if(!regional)continue;
  phase('topology');
  const coverage=(items,start,end,vertical)=>{
   const ranges=[];
   for(const p of items){charge();const lo=vertical?p.line.y1:p.line.x1,hi=vertical?p.line.y2:p.line.x2;if(hi>start&&lo<end)ranges.push([Math.max(start,lo),Math.min(end,hi)]);}
   if(!ranges.length)return 0;
   ranges.sort((a,b)=>a[0]-b[0]);let next=start;
   for(const [lo,hi]of ranges){if(lo>next)return -1;next=Math.max(next,hi);}return next>=end?1:-1;
  };
  const half=b=>Math.min(...b.items.map(p=>Math.min(p.box.width,p.box.height)))/2;
  const ve=Array.from({length:rows},(_,r)=>xs.map(x=>coverage(x.items,ys[r].at+half(ys[r]),ys[r+1].at-half(ys[r+1]),true)));
  const he=ys.map(y=>Array.from({length:cols},(_,c)=>coverage(y.items,xs[c].at+half(xs[c]),xs[c+1].at-half(xs[c+1]),false)));
  if(ve.flat().includes(-1)||he.flat().includes(-1)||ve.some(row=>row[0]!==1||row.at(-1)!==1)||he[0].some(n=>n!==1)||he.at(-1).some(n=>n!==1))continue;
  const seen=new Set(),cells=[];let invalid=false;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++) {
   const key=r*cols+c;if(seen.has(key))continue;
   const todo=[[r,c]],parts=[];seen.add(key);
   while(todo.length){const [rr,cc]=todo.pop();parts.push([rr,cc]);for(const [nr,nc,edge]of [[rr-1,cc,he[rr][cc]],[rr+1,cc,he[rr+1][cc]],[rr,cc-1,ve[rr][cc]],[rr,cc+1,ve[rr][cc+1]]])if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&edge===0&&!seen.has(nr*cols+nc)){seen.add(nr*cols+nc);todo.push([nr,nc]);}}
   const r0=Math.min(...parts.map(p=>p[0])),r1=Math.max(...parts.map(p=>p[0])),c0=Math.min(...parts.map(p=>p[1])),c1=Math.max(...parts.map(p=>p[1]));
   if(parts.length!==(r1-r0+1)*(c1-c0+1)){invalid=true;continue;}
   for(let rr=r0;rr<=r1;rr++)if(ve[rr][c0]!==1||ve[rr][c1+1]!==1)invalid=true;
   for(let cc=c0;cc<=c1;cc++)if(he[r0][cc]!==1||he[r1+1][cc]!==1)invalid=true;
   for(let rr=r0;rr<=r1;rr++)for(let cc=c0+1;cc<=c1;cc++)if(ve[rr][cc]!==0)invalid=true;
   for(let rr=r0+1;rr<=r1;rr++)for(let cc=c0;cc<=c1;cc++)if(he[rr][cc]!==0)invalid=true;
   cells.push({id:`c${r0+1}-${c0+1}`,row:r0,column:c0,rowSpan:r1-r0+1,colSpan:c1-c0+1,text:'',role:'value',headerCellIds:[],sourceFragmentIds:[],box:{x:xs[c0].at,y:ys[r0].at,width:xs[c1+1].at-xs[c0].at,height:ys[r1+1].at-ys[r0].at},parts:[]});
  }
  if(invalid)continue;
  phase('background');const firstBorder=Math.min(...component.map(p=>p.operatorIndex)),envelopes=[];
  for(const paint of regional.otherPaints) {
   if(paint.kind!=='filled-rectangles'||paint.operatorIndex>=firstBorder||!valid(paint.box)||!inside(painted,paint.box)||!Array.isArray(paint.rectangles)||!paint.rectangles.length){invalid=true;break;}
   for(const rect of paint.rectangles) {
    const matches=(bands,at)=>bands.map((band,index)=>at>=band.low&&at<=band.high?index:-1).filter(index=>index>=0);
    if(!valid(rect)||!inside(painted,rect)){invalid=true;break;}
    const [left,right,top,bottom]=[matches(xs,rect.x),matches(xs,rect.x+rect.width),matches(ys,rect.y),matches(ys,rect.y+rect.height)];
    if([left,right,top,bottom].some(a=>a.length!==1)||left[0]>=right[0]||top[0]>=bottom[0]){invalid=true;break;}
    const [c0,c1,r0,r1]=[left[0],right[0],top[0],bottom[0]];
    for(const cell of cells)if(cell.row<r1&&cell.row+cell.rowSpan>r0&&cell.column<c1&&cell.column+cell.colSpan>c0&&
      !(cell.row>=r0&&cell.row+cell.rowSpan<=r1&&cell.column>=c0&&cell.column+cell.colSpan<=c1))invalid=true;
    envelopes.push({operatorIndex:paint.operatorIndex,startRow:r0,endRow:r1,startColumn:c0,endColumn:c1,sourceBox:{...rect},sourcePathBox:{...paint.box},fill:paint.fill,semanticRole:'unknown',visibility:'unverified',relation:'before-borders'});
   }
  }
  if(invalid)continue;
  // Outside text may share the page/height, but touching the actual border
  // footprint cannot be discarded as unrelated when establishing ownership.
  phase('nativecelltext');const members=native.filter(p=>touch(painted,p));
  if(!members.length||members.some(p=>!inside(box,p)||!selected.has(p.id)))continue;
  for(const p of members) {
   const owners=cells.filter(cell=>{charge();return inside(cell.box,p);});
   if(owners.length!==1||component.some(rule=>intersects(rule.box,p))){invalid=true;break;}
   owners[0].parts.push(p);
  }
  if(invalid)continue;
  for(const cell of cells) {
   // Literal source-item inventory, not inferred visible-ink reading order.
   // Superscript boxes and small text-box overlaps do not prove ink collisions.
   cell.parts.sort((a,b)=>a.id-b.id);let last;
   for(const p of cell.parts) {
    const newLine=last&&p.y>=last.y+last.height,gap=last?p.x-last.x-last.width:0,sameBaseline=last&&p.y===last.y&&p.height===last.height;
    cell.text+=(last?(newLine?'\n':sameBaseline&&gap>Math.max(1,p.height*.12)&&!/\s$/.test(cell.text)&&!/^\s/.test(p.text)?' ':''):'')+p.text;
    cell.sourceFragmentIds.push(`${pageId}-f${p.id}`);last=p;
   }
   delete cell.parts;
  }
  if(invalid)continue;
  phase('mixedline');const ids=members.map(p=>p.id),owned=new Set(ids);
  if(lines.some(line=>line.fragmentIds.some(id=>owned.has(id))&&line.fragmentIds.some(id=>!owned.has(id))))continue;
  const draft={table:{rowCount:rows,columnCount:cols,cells,reviewed:false,scaffold:true,geometryOnly:true,textAssembly:'source-item-order-draft',textLayoutVerified:false,...(envelopes.length?{earlyPaintEnvelopes:envelopes}:{})},box,paintedBox:painted,fragmentIndices:ids,captionFragmentIndices:captionMatches[0].fragmentIds};
  drafts.push(draft);phase('complete');if(attempt)attempt.outcome='draft';draftAttempts.set(draft,attempt);
 }
 // A single caption must never authorize several independent frames, nor may
 // disjoint geometry consume a native fragment twice.
 return drafts.filter(draft=>{
  const captionConflict=drafts.some(other=>other!==draft&&draft.captionFragmentIndices.some(id=>other.captionFragmentIndices.includes(id)));
  const nativeConflict=drafts.some(other=>other!==draft&&draft.fragmentIndices.some(id=>other.fragmentIndices.includes(id)));
  if(captionConflict||nativeConflict){const attempt=draftAttempts.get(draft);if(attempt){attempt.outcome='null';attempt.phase=captionConflict?'caption':'nativecelltext';}return false;}
  return true;
 }).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}
