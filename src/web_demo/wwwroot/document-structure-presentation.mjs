import {getStructurePresentation} from './document-structure-correspondence.mjs';
import {parseFootnoteTarget} from './document-structure.mjs';
let renderSerial=0;
export function clearStructurePresentation(container){if(container){container.replaceChildren();container.hidden=true;}}
/** Literal, bounded source/draft DATA display; never a graph edit or approval. */
export function renderStructurePresentation(container,comparison,{targetDirection='auto'}={}){
 clearStructurePresentation(container);
 const view=getStructurePresentation(comparison);if(!container||!view)return false;
 const doc=container.ownerDocument,prefix=`mtqc-structure-${++renderSerial}`,fragment=doc.createDocumentFragment(),pairs=new Map();
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const clearFocus=()=>{for(const nodes of pairs.values())for(const n of nodes)n.classList.remove('is-corresponding');};
 const summary=el('p',`Structure correspondence: ${view.status}. Positions and literal data only; independent source and translation review required.`);summary.className='structure-view-summary';fragment.append(summary);
 if(view.issues.length){const findings=el('p',view.issues.map(i=>`${i.code}${i.regionId?` · ${i.regionId}`:''}${i.cellId?` · ${i.cellId}`:''}`).join('; '));findings.className='structure-view-findings';fragment.append(findings);}
 const columns=el('div');columns.className='structure-view-columns';fragment.append(columns);
 for(const [name,data] of [['source',view.source],['target',view.target]]){
  const section=el('section');section.dataset.structureSide=name;section.className='structure-view-side';section.dir='ltr';section.append(el('h3',name==='source'?'Reviewed source structure':'Returned draft structure · unverified'));
  const regionIds=new Map(data.regions.map((r,i)=>[r.id,`${prefix}-${name}-r${i}`]));
  const cellIds=new Map();data.regions.forEach((r,i)=>{if(r.type==='table')r.cells.forEach((c,j)=>cellIds.set(r.id+'\0'+c.id,`${prefix}-${name}-r${i}-c${j}`));});
  data.regions.forEach((r,ri)=>{
   const region=el('section');region.id=regionIds.get(r.id);region.dataset.regionId=r.id;region.className='structure-view-region';region.append(el('h4',`${r.type} · ${r.id}`));
   if(r.type==='table'){
    region.append(el('p',r.text));
    const order=el('p',`Received cell order: ${r.cells.map(c=>c.id).join(', ')}`);order.className='structure-view-metadata';region.append(order);
    const ownIds=new Map(r.cells.map((c,i)=>[c.id,`${prefix}-${name}-r${ri}-c${i}`]));
    const cellNode=(c,tag)=>{
     const node=el(tag,c.text);node.id=ownIds.get(c.id);node.tabIndex=0;
     for(const key of ['id','row','column','rowSpan','colSpan','role'])node.dataset[key==='id'?'cellId':key]=String(c[key]);
     node.dataset.regionId=r.id;node.dataset.headers=c.headers.join(',');node.rowSpan=c.rowSpan;node.colSpan=c.colSpan;
     node.dir='auto';
     if(r.layout==='grid'&&c.headers.length)node.setAttribute('headers',c.headers.map(id=>ownIds.get(id)).join(' '));
     const label=`${c.id} · row ${c.row+1}, column ${c.column+1} · span ${c.rowSpan}×${c.colSpan} · ${c.role} · headers: ${c.headers.join(', ')||'none'}`;
     node.title=label;node.setAttribute('aria-label',`${label} · ${c.text}`);
     const key=r.id+'\0'+c.id;const list=pairs.get(key)||[];list.push(node);pairs.set(key,list);
     node.addEventListener('focus',()=>{clearFocus();for(const peer of pairs.get(key)||[])peer.classList.add('is-corresponding');});node.addEventListener('blur',clearFocus);
     return node;
    };
    if(r.layout==='grid'){
     const wrap=el('div');wrap.className='structure-view-scroll';const table=el('table');table.dir='ltr';table.append(el('caption',`${name==='source'?'Source':'Draft'} · ${r.rowCount} rows × ${r.columnCount} columns`));const body=el('tbody');
     for(let row=0;row<r.rowCount;row++){const tr=el('tr');for(const c of r.cells.filter(c=>c.row===row).sort((a,b)=>a.column-b.column))tr.append(cellNode(c,c.role==='header'?'th':'td'));body.append(tr);}
     table.append(body);wrap.append(table);region.append(wrap);
    }else{
     region.append(el('p',`Grid withheld: ${r.layoutReason}. Received cells are listed without repairing their positions.`));
     const list=el('div');list.className='structure-view-cards';for(const c of r.cells){const card=el('div');card.className='structure-view-card';card.append(el('p',`${c.id} · row ${c.row+1}, column ${c.column+1} · span ${c.rowSpan}×${c.colSpan} · ${c.role} · headers: ${c.headers.join(', ')||'none'}`),cellNode(c,'p'));list.append(card);}region.append(list);
    }
   }else{
    const literal=el('p',r.text);literal.dir=r.type==='equation'?'ltr':name==='target'&&targetDirection==='rtl'?'rtl':'auto';literal.className=r.type==='equation'?'structure-view-equation':'structure-view-literal';region.append(literal);
    if(r.type==='equation'){
     if(!r.math)region.append(el('p','Literal notation only; native positions unknown.'));
     else{
      const m=r.math,crop=m.sourceBox,plane=el('div');plane.dataset.mathSide=name;plane.className='structure-view-math';
      plane.style.position='relative';plane.style.width='100%';plane.style.aspectRatio=String(crop.width/crop.height);plane.style.border='1px solid currentColor';plane.dir='ltr';
      const place=(node,b)=>{node.style.position='absolute';node.style.left=(100*(b.x-crop.x)/crop.width)+'%';node.style.top=(100*(b.y-crop.y)/crop.height)+'%';node.style.width=(100*b.width/crop.width)+'%';node.style.height=(100*b.height/crop.height)+'%';};
      for(const bar of m.bars){const node=el('span');node.dataset.mathBarId=bar.id;node.title=`Original bar ${bar.id} · operator ${bar.operatorIndex}`;place(node,bar.box);node.style.backgroundColor='currentColor';plane.append(node);}
      for(const token of m.tokens){
       const node=el('span',token.text);node.dataset.mathTokenId=token.id;node.dataset.regionId=r.id;node.tabIndex=0;node.dir='ltr';node.style.whiteSpace='pre';node.style.outline='1px dotted currentColor';node.title=`Native fragment ${token.id} · source index ${token.sourceIndex}; glyphs ${token.glyphs===null?'unknown':token.glyphs.length}`;place(node,token.box);
       const key=r.id+'\0math\0'+token.id,list=pairs.get(key)||[];list.push(node);pairs.set(key,list);
       node.addEventListener('focus',()=>{clearFocus();for(const peer of pairs.get(key)||[])peer.classList.add('is-corresponding');});node.addEventListener('blur',clearFocus);
       plane.append(node);
      }
      region.append(plane,el('p',`Native fragment positions · glyphs ${m.glyphStatus} · bars ${m.barStatus}. Text labels use display fonts; this is not original glyph ink or semantic equation typesetting.`));
      const relations=el('pre',JSON.stringify(m.relations,null,2));relations.className='structure-view-math-relations';region.append(relations);
      for(const token of m.tokens)if(token.glyphs!==null)region.append(el('p',`${token.id} glyph DATA: `+token.glyphs.map(g=>`${g.glyphOrdinal}@${g.operatorIndex} ${g.unicode}${g.painted?'':' (unpainted)'}`).join(' · ')));
     }
    }
    if(r.type==='footnote'){region.append(el('p',`Note decision: ${r.decision}`));for(const target of r.targets){const ref=parseFootnoteTarget(target),anchor=ref?.cellId!==null&&ref?cellIds.get(ref.regionId+'\0'+ref.cellId):regionIds.get(target);if(anchor){const link=el('a',`Target: ${target}`);link.setAttribute('href','#'+anchor);region.append(link);}else region.append(el('p',`Target: ${target} · outside this excerpt`));}}
   }
   section.append(region);
  });columns.append(section);
 }
 container.append(fragment);container.hidden=false;return true;
}
