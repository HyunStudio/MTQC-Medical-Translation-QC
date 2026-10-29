import {isTableReferenceText} from './document-table-grid.mjs';
import {shareRuleRasterSource} from './document-horizontal-rules.mjs';
import {assessRasterRegion,ruleMetadataStamp} from './document-raster-regions.mjs';
const validBox=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const touch=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function bands(items,vertical){
 const groups=[];
 for(const item of [...items].sort((a,b)=>(vertical?a.line.x1-b.line.x1:a.line.y1-b.line.y1))){
  const low=vertical?item.box.x:item.box.y,high=low+(vertical?item.box.width:item.box.height);
  const last=groups.at(-1);
  if(last&&low<=last.high&&high>=last.low){last.low=Math.max(last.low,low);last.high=Math.min(last.high,high);last.items.push(item);}
  else groups.push({low,high,at:vertical?item.line.x1:item.line.y1,items:[item]});
 }
 return groups;
}
// Local historical producer evidence only; these seals never authorize a grid.
const tableSourceSeals=new WeakMap(),ruleAttempts=new WeakMap();
function tableDataSnapshot(value){
 try{
  let nodes=0,properties=0,strings=0;const seen=new Map(),refs=[];
  const text=s=>{if((strings+=s.length)>65536)throw 0;return s;};
  const visit=(v,depth=0)=>{
   if(++nodes>32768||depth>24)throw 0;
   if(v===null)return ['null'];
   if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
   if(typeof v==='string')return ['string',text(v)];
   if(typeof v==='boolean'||typeof v==='undefined')return [typeof v,v??null];
   if(typeof v!=='object')throw 0;
   if(seen.has(v))return ['ref',seen.get(v)];
   const proto=Object.getPrototypeOf(v),ctor=proto&&Object.getOwnPropertyDescriptor(proto,'constructor');
   const array=Array.isArray(v),nativeName=array?'Array':'Object',nativeCtor=ctor&&Object.hasOwn(ctor,'value')&&typeof ctor.value==='function'?ctor.value:null;
   if(proto!==null||array){
    const declared=nativeCtor&&Object.getOwnPropertyDescriptor(nativeCtor,'prototype');
    if(!proto||!declared||!Object.hasOwn(declared,'value')||declared.value!==proto||
      Function.prototype.toString.call(nativeCtor)!=='function '+nativeName+'() { [native code] }'||(!array&&Object.getPrototypeOf(proto)!==null))throw 0;
   }
   const id=seen.size;seen.set(v,id);refs.push(v,proto);
   const keys=Reflect.ownKeys(v);if((properties+=keys.length)>8192)throw 0;
   for(const key of keys){if(typeof key!=='string')throw 0;text(key);}keys.sort();
   return [Array.isArray(v)?'array':proto===null?'null-object':'object',id,keys.map(key=>{
    const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!Object.hasOwn(d,'value'))throw 0;
    return [key,d.enumerable,d.configurable,d.writable,visit(d.value,depth+1)];
   })];
  };
  return {stamp:JSON.stringify(visit(value)),refs};
 }catch{return null;}
}
export function captureTableProposalSource(input){const snapshot=tableDataSnapshot(input);if(!snapshot)return null;const seal=Object.freeze({});tableSourceSeals.set(seal,snapshot);return seal;}
export function isTableProposalSourceCurrent(seal,input){const old=tableSourceSeals.get(seal),now=old&&tableDataSnapshot(input);return Boolean(old&&now&&old.stamp===now.stamp&&old.refs.length===now.refs.length&&old.refs.every((ref,index)=>ref===now.refs[index]));}
function runRuleAttempt(input,positions){
 const mode=positions?'open':'closed';if(input&&typeof input==='object'){const old=ruleAttempts.get(input);if(old)delete old[mode];}
 const seal=captureTableProposalSource(input),trace={phase:'input'};let result=null,outcome='null';
 try{result=propose(input,positions,trace);if(result)outcome='draft';}catch{outcome='caught';}
 if(seal&&input&&typeof input==='object'){
  let modes=ruleAttempts.get(input);if(!modes){modes={};ruleAttempts.set(input,modes);}
  modes[positions?'open':'closed']={seal,report:Object.freeze({mode:positions?'open':'closed',phase:trace.phase,outcome,sourceReviewed:false,visibility:'unverified'})};
 }
 return result;
}
export function getRuledTableAttempt(input,positions=false){const entry=ruleAttempts.get(input)?.[positions===true?'open':'closed'];return entry&&isTableProposalSourceCurrent(entry.seal,input)?entry.report:null;}
/** Geometry drafts only. No intentional merge, header or visibility is inferred. */
export function proposeRuledTableGrid(input={}){
 return runRuleAttempt(input,false);
}
/** Incomplete source positions only; open source lines are never extended. */
export function proposeOpenFirstRowTablePositions(input={}){
 return runRuleAttempt(input,true);
}
function propose({lines,fragments,width,height,pageId,ruleHints,verticalRuleHints,rasterHints},positions=false,trace=null){
 const phase=name=>{if(trace)trace.phase=name;};phase('input');
 if(![width,height].every(n=>Number.isFinite(n)&&n>0)||typeof pageId!=='string'||!pageId||pageId.length>128||
  !Array.isArray(lines)||!lines.length||lines.length>1000||!Array.isArray(fragments)||fragments.length>10000)return null;
 phase('metadata');
 if(ruleMetadataStamp([ruleHints,verticalRuleHints])===null)return null;
 phase('rule-profile');
 for(const [h,version] of [[ruleHints,'pdfjs-horizontal-rule-evidence-v1'],[verticalRuleHints,'pdfjs-vertical-rule-evidence-v1']])
  if(h?.version!==version||h.width!==width||h.height!==height||!Array.isArray(h.candidates)||h.candidates.length>256)return null;
 phase('source-custody');
 if(!shareRuleRasterSource(ruleHints,verticalRuleHints,rasterHints))return null;
 phase('native-inventory');
 const page={x:0,y:0,width,height},native=[];
 for(const [id,p] of fragments.entries()){
  if(!p||typeof p.text!=='string')return null;if(!p.text.trim())continue;
  if(!validBox(p)||!contains(page,p))return null;native.push({...p,id});
 }
 phase('line-inventory');
 const selected=new Set(),captions=[];
 for(const line of lines){
  if(!line||typeof line.text!=='string'||!Array.isArray(line.fragmentIds))return null;
  for(const id of line.fragmentIds){if(!Number.isSafeInteger(id)||id<0||id>=fragments.length||selected.has(id)||!fragments[id].text.trim())return null;selected.add(id);}
  if(/^\s*TABLE\s+\d+\b/i.test(line.text)&&!isTableReferenceText(line.text))captions.push(line);
 }
 phase('caption');
 if(captions.length!==1)return null;
 phase('rule-validation');
 let work=0;const charge=()=>{if(++work>200000)throw new RangeError('geometry-work-limit');};
 const rejected=[];
 const usable=(h,vertical)=>h.candidates.filter(c=>{
  const l=c?.line,b=c?.box;
  if(!l||![l.x1,l.y1,l.x2,l.y2].every(Number.isFinite)||!validBox(b)||!contains(page,b)||c.status!=='unverified'||c.occlusion!=='unknown'||!Number.isSafeInteger(c.operatorIndex)||c.operatorIndex<0||!/^#[0-9a-f]{6}$/i.test(c.stroke))throw new TypeError('invalid-rule');
  if(vertical?(l.x1!==l.x2||!(l.y2>l.y1)||b.y!==l.y1||b.height!==l.y2-l.y1||b.x+b.width/2!==l.x1):(l.y1!==l.y2||!(l.x2>l.x1)||b.x!==l.x1||b.width!==l.x2-l.x1||b.y+b.height/2!==l.y1))throw new TypeError('inconsistent-rule');
  const accepted=(vertical?b.width:b.height)<=2&&c.stroke.toLowerCase()!=='#ffffff';if(!accepted)rejected.push(c);return accepted;
 });
 const h=usable(ruleHints,false),v=usable(verticalRuleHints,true),hb=bands(h,false),vb=bands(v,true);
 phase('bands');
 if(hb.length<4||vb.length<3)return null;
 phase('frame-search');
 const cap=captions[0],capParts=cap.fragmentIds.map(i=>fragments[i]);
 const frames=[],frameKeys=new Set();
 // Full single source strokes at both outside edges close the frame. Split or
 // damaged outside rules cannot be combined into an apparently clean prefix.
 for(const left of v)for(const right of v){charge();if(!(right.line.x1>left.line.x1))continue;
  const top=hb.filter(b=>{charge();return left.line.y1>=b.low&&left.line.y1<=b.high&&right.line.y1>=b.low&&right.line.y1<=b.high;});
  const bottom=hb.filter(b=>{charge();return left.line.y2>=b.low&&left.line.y2<=b.high&&right.line.y2>=b.low&&right.line.y2<=b.high;});
  if(top.length!==1||bottom.length!==1||top[0].at>=bottom[0].at)continue;
  const box={x:left.line.x1,y:top[0].at,width:right.line.x1-left.line.x1,height:bottom[0].at-top[0].at};
  const key=[box.x,box.y,box.width,box.height].join(':');if(frameKeys.has(key))continue;frameKeys.add(key);
  const localH=h.filter(p=>{charge();return p.line.x2>box.x&&p.line.x1<box.x+box.width&&p.line.y1>=box.y&&p.line.y1<=box.y+box.height;});
  const localV=v.filter(p=>{charge();return p.line.y2>box.y&&p.line.y1<box.y+box.height&&p.line.x1>=box.x&&p.line.x1<=box.x+box.width;});
  const xs=bands(localV,true),ys=bands(localH,false);
  if(xs.length<3||xs.length>21||ys.length<4||ys.length>21||xs[0].at!==box.x||xs.at(-1).at!==box.x+box.width)continue;
  const envelopes=[],envelopeSources=[];
  const firstBorder=Math.min(...localH.map(p=>p.operatorIndex),...localV.map(p=>p.operatorIndex));
  let unknownPaint=false;
  for(const p of rejected){charge();if(!touch(p.box,box))continue;
   // This identifies only an early source envelope, not a background or visible ink.
   if(p.line.y1!==p.line.y2||p.box.height<=2||p.operatorIndex>=firstBorder||
    p.line.x1<xs[0].low||p.line.x1>xs[0].high||p.line.x2<xs.at(-1).low||p.line.x2>xs.at(-1).high){unknownPaint=true;break;}
   const starts=[],ends=[];
   for(let i=0;i<ys.length;i++){charge();if(p.box.y>=ys[i].low&&p.box.y<=ys[i].high)starts.push(i);const end=p.box.y+p.box.height;if(end>=ys[i].low&&end<=ys[i].high)ends.push(i);}
   if(starts.length!==1||ends.length!==1||starts[0]>=ends[0]){unknownPaint=true;break;}
   envelopes.push({operatorIndex:p.operatorIndex,startRow:starts[0],endRow:ends[0],sourceBox:{...p.box},sourceLine:{...p.line},semanticRole:'unknown',visibility:'unverified',relation:'before-borders'});envelopeSources.push(p);
  }
  if(unknownPaint)continue;
  // Compatibility uses common band intersections; raster clearance uses the
  // UNION of every participating outside stroke, including wider duplicate paint.
  const outer=[...ys[0].items,...ys.at(-1).items,...xs[0].items,...xs.at(-1).items,...envelopeSources];
  for(const _ of outer)charge();
  const px=Math.min(...outer.map(p=>p.box.x)),py=Math.min(...outer.map(p=>p.box.y));
  const painted={x:px,y:py,width:Math.max(...outer.map(p=>p.box.x+p.box.width))-px,height:Math.max(...outer.map(p=>p.box.y+p.box.height))-py};
  if(capParts.some(p=>{charge();return p.y+p.height>painted.y||p.x<painted.x||p.x+p.width>painted.x+painted.width;})||
   painted.y-Math.max(...capParts.map(p=>p.y+p.height))>4*Math.max(...capParts.map(p=>p.height)))continue;
  // This profile has no parallel prose at table height: an adjacent native cell
  // prevents a partial frame from being treated as the whole table.
  const members=native.filter(p=>{charge();return p.y<box.y+box.height&&p.y+p.height>box.y;});
  if(members.length<6||members.length>400||members.some(p=>{charge();return !contains(box,p)||!selected.has(p.id);}))continue;
  if(assessRasterRegion(rasterHints,painted).status!=='raster-disjoint')continue;
  frames.push({key,box,painted,xs,ys,members,envelopes});
 }
 phase('frame-unique');
 if(frames.length!==1)return null;
 const {box,painted,xs,ys,members,envelopes}=frames[0],rows=ys.length-1,cols=xs.length-1;
 const coverage=(items,start,end,vertical)=>{
  const ranges=[];for(const p of items){charge();const lo=vertical?p.line.y1:p.line.x1,hi=vertical?p.line.y2:p.line.x2;if(hi>start&&lo<end)ranges.push([Math.max(lo,start),Math.min(hi,end)]);}
  if(!ranges.length)return 0;ranges.sort((a,b)=>a[0]-b[0]);let next=start;
  for(const [lo,hi] of ranges){if(lo>next)return -1;next=Math.max(next,hi);}return next>=end?1:-1;
 };
 const half=b=>Math.min(...b.items.map(p=>Math.min(p.box.width,p.box.height)))/2;
 const ve=Array.from({length:rows},()=>[]),he=Array.from({length:rows+1},()=>[]);
 for(let r=0;r<rows;r++)for(let c=0;c<=cols;c++)ve[r][c]=coverage(xs[c].items,ys[r].at+half(ys[r]),ys[r+1].at-half(ys[r+1]),true);
 for(let r=0;r<=rows;r++)for(let c=0;c<cols;c++)he[r][c]=coverage(ys[r].items,xs[c].at+half(xs[c]),xs[c+1].at-half(xs[c+1]),false);
 phase('topology');
 const gaps=[];
 if(positions){
  if(cols<3||rows<3||!envelopes.some(e=>e.startRow===0&&e.endRow===1)||he.some(row=>row.some(n=>n!==1))||
   ve.some((row,r)=>row.some((n,c)=>n!==(r===0&&c>0&&c<cols?-1:1))))return null;
  const topEnd=Math.max(...ys[0].items.map(p=>p.box.y+p.box.height));let start;
  for(let c=1;c<cols;c++){
   const parts=xs[c].items.filter(p=>{charge();return p.line.y2>ys[0].at&&p.line.y1<ys[1].at;});
   if(parts.length!==1)return null;const p=parts[0];
   if(!(p.line.y1>topEnd)||p.line.y2<ys[1].low||p.line.y2>ys[1].high||(start!==undefined&&start!==p.line.y1))return null;
   start=p.line.y1;gaps.push({column:c,operatorIndex:p.operatorIndex,dividerX:p.line.x1,originalStartY:p.line.y1,originalEndY:p.line.y2,topBorderPaintEnd:topEnd,sourceBox:{...p.box},sourceLine:{...p.line}});
  }
 }else if(ve.flat().includes(-1)||he.flat().includes(-1)||ve.some(row=>row[0]!==1||row.at(-1)!==1)||he[0].some(n=>n!==1)||he.at(-1).some(n=>n!==1))return null;
 phase('cell-topology');
 const seen=new Set(),cells=[];
 if(positions)for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)cells.push({id:`c${r+1}-${c+1}`,row:r,column:c,rowSpan:1,colSpan:1,text:'',role:'value',headerCellIds:[],sourceFragmentIds:[],box:{x:xs[c].at,y:ys[r].at,width:xs[c+1].at-xs[c].at,height:ys[r+1].at-ys[r].at},parts:[]});
 else
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const key=r*cols+c;if(seen.has(key))continue;const todo=[[r,c]],part=[];seen.add(key);
  while(todo.length){const [rr,cc]=todo.pop();part.push([rr,cc]);for(const [nr,nc,edge] of [[rr-1,cc,he[rr][cc]],[rr+1,cc,he[rr+1][cc]],[rr,cc-1,ve[rr][cc]],[rr,cc+1,ve[rr][cc+1]]])if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&edge===0&&!seen.has(nr*cols+nc)){seen.add(nr*cols+nc);todo.push([nr,nc]);}}
  const r0=Math.min(...part.map(p=>p[0])),r1=Math.max(...part.map(p=>p[0])),c0=Math.min(...part.map(p=>p[1])),c1=Math.max(...part.map(p=>p[1]));
  if(part.length!==(r1-r0+1)*(c1-c0+1))return null;
  // A rectangular face also needs every outer boundary, not an accidental
  // rectangular flood fill enclosed only by a neighboring face.
  for(let rr=r0;rr<=r1;rr++)if(ve[rr][c0]!==1||ve[rr][c1+1]!==1)return null;
  for(let cc=c0;cc<=c1;cc++)if(he[r0][cc]!==1||he[r1+1][cc]!==1)return null;
  for(let rr=r0;rr<=r1;rr++)for(let cc=c0+1;cc<=c1;cc++){charge();if(ve[rr][cc]!==0)return null;}
  for(let rr=r0+1;rr<=r1;rr++)for(let cc=c0;cc<=c1;cc++){charge();if(he[rr][cc]!==0)return null;}
  cells.push({id:`c${r0+1}-${c0+1}`,row:r0,column:c0,rowSpan:r1-r0+1,colSpan:c1-c0+1,text:'',role:'value',headerCellIds:[],sourceFragmentIds:[],box:{x:xs[c0].at,y:ys[r0].at,width:xs[c1+1].at-xs[c0].at,height:ys[r1+1].at-ys[r0].at},parts:[]});
 }
 phase('cell-ownership');
 for(const p of members){
  const matches=cells.filter(c=>{charge();return contains(c.box,p);});if(matches.length!==1)return null;
  if([...h,...v].some(line=>{charge();return intersects(line.box,p);}))return null;
  matches[0].parts.push(p);
 }
 if(positions){
  const first=cells.filter(c=>c.row===0),anchor=first[0].parts[0];
  if(!anchor||first.some(c=>{charge();return c.parts.length!==1||c.parts[0].y!==anchor.y||c.parts[0].height!==anchor.height||!(c.parts[0].y>gaps[0].originalStartY);}))return null;
 }
 phase('cell-text');
 for(const cell of cells){cell.parts.sort((a,b)=>a.y-b.y||a.x-b.x);let last;
  for(const p of cell.parts){
   const newLine=last&&p.y>=last.y+last.height;
   const gap=last?p.x-last.x-last.width:0;
   // Only an exact shared baseline joins runs. Overlap or shifted scripts are
   // ambiguous here and stay held rather than changing numbers or formula tokens.
   if(last&&!newLine&&(p.y!==last.y||p.height!==last.height||gap<0))return null;
   cell.text+=(last?(newLine?'\n':(gap>Math.max(1,p.height*.12)&&!/\s$/.test(cell.text)&&!/^\s/.test(p.text)?' ':'')):'')+p.text;
   last=p;cell.sourceFragmentIds.push(`${pageId}-f${p.id}`);
  }
  cell.text=cell.text.trim();delete cell.parts;
 }
 cells.sort((a,b)=>a.row-b.row||a.column-b.column);
 const ids=members.map(p=>p.id),idSet=new Set(ids);
 phase('reading-lines');
 if(lines.some(line=>line.fragmentIds.some(id=>idSet.has(id))&&line.fragmentIds.some(id=>!idSet.has(id))))return null;
 phase('complete');
 return {table:{rowCount:rows,columnCount:cols,cells,reviewed:false,scaffold:true,geometryOnly:true,...(envelopes.length?{earlyPaintEnvelopes:envelopes}:{}),...(positions?{boundaryEvidence:'partial-first-row-source-positions',firstRowSourceGaps:gaps}:{})},box,paintedBox:painted,fragmentIndices:ids,captionFragmentIndices:cap.fragmentIds};
}
