import {validTableDimensions,VISUAL_PAGE_CONCERNS} from '../web_demo/wwwroot/document-structure.mjs';
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const shape=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const ids=(v,maximum=8192)=>Array.isArray(v)&&v.length<=maximum&&v.every(id)&&new Set(v).size===v.length;
const box=(v,p)=>shape(v,['x','y','width','height'])&&Object.values(v).every(Number.isFinite)&&v.x>=0&&v.y>=0&&v.width>0&&v.height>0&&v.x+v.width<=p.width&&v.y+v.height<=p.height;
const regions=new Set(['heading','paragraph','table','equation','figure','caption','footnote','other']);
const edges=new Set(['reading-next','caption-of','footnote-of','cell-of','label-in-figure']);

// Called only after the bounded data-only C2a snapshot. This checks schema and
// references, not coverage, correct content, review authority or readiness.
export function validPrivateDraftSchema(document){
  if(!shape(document,['schemaVersion','pages','selectedRegionIds'])||document.schemaVersion!==1||!ids(document.selectedRegionIds,512))return false;
  const regionMap=new Map(),cellMap=new Map(),labelMap=new Map(),edgeIds=new Set();
  const register=(key,map,value)=>{if(!id(key)||map.has(key))return false;map.set(key,value);return true;};
  for(const p of document.pages){
    if(!shape(p,['id','width','height','fragmentIds','regions','edges','issues','visualInventoryConfirmed'],['visualConcernReviews']))return false;
    for(const r of p.regions){
      if(!shape(r,['id','type','box','fragmentIds','text','provenance','status'],['exclusionReason','table','equationReview','figureReview','footnoteReview'])||
        !register(r.id,regionMap,{region:r,page:p})||!regions.has(r.type)||!box(r.box,p)||!ids(r.fragmentIds)||typeof r.text!=='string'||
        !id(r.provenance)||!['proposed','verified','unresolved','excluded'].includes(r.status)||
        (r.exclusionReason!==undefined&&typeof r.exclusionReason!=='string'))return false;
      if(r.table!==undefined){
        const t=r.table;
        if(!shape(t,['rowCount','columnCount','cells','reviewed'])||!validTableDimensions(t.rowCount,t.columnCount)||
          typeof t.reviewed!=='boolean'||!Array.isArray(t.cells)||t.cells.length>400)return false;
        const local=new Set();
        for(const c of t.cells){
          if(!shape(c,['id','row','column','rowSpan','colSpan','text','role','headerCellIds'],['blankReason'])||
            !id(c.id)||local.has(c.id)||![c.row,c.column,c.rowSpan,c.colSpan].every(Number.isSafeInteger)||
            c.row<0||c.column<0||c.rowSpan<1||c.colSpan<1||c.row+c.rowSpan>t.rowCount||c.column+c.colSpan>t.columnCount||
            typeof c.text!=='string'||!['header','value','blank'].includes(c.role)||!ids(c.headerCellIds,400)||
            (c.blankReason!==undefined&&typeof c.blankReason!=='string'))return false;
          local.add(c.id);
        }
        if(t.cells.some(c=>c.headerCellIds.some(key=>!local.has(key))))return false;
        cellMap.set(r.id,local);
      }
      if(r.equationReview!==undefined&&(!shape(r.equationReview,['sourceChecked'])||typeof r.equationReview.sourceChecked!=='boolean'))return false;
      if(r.figureReview!==undefined){
        const f=r.figureReview;
        if(!shape(f,['decision','labels','sourceChecked'])||!['labels-transcribed','no-internal-text'].includes(f.decision)||
          typeof f.sourceChecked!=='boolean'||!Array.isArray(f.labels)||f.labels.length>1024)return false;
        const local=new Set();
        for(const l of f.labels){if(!shape(l,['id','text'],['box'])||!id(l.id)||local.has(l.id)||typeof l.text!=='string'||(l.box!==undefined&&!box(l.box,p)))return false;local.add(l.id);}
        labelMap.set(r.id,local);
      }
      if(r.footnoteReview!==undefined){const n=r.footnoteReview;if(!shape(n,['decision','sourceChecked','standaloneReason'])||
        !['linked','standalone'].includes(n.decision)||typeof n.sourceChecked!=='boolean'||typeof n.standaloneReason!=='string')return false;}
    }
  }
  if(!document.selectedRegionIds.every(key=>regionMap.has(key)))return false;
  for(const p of document.pages){
    for(const e of p.edges){
      if(!shape(e,['id','type','from','to','status'])||!id(e.id)||edgeIds.has(e.id)||!edges.has(e.type)||!id(e.from)||!id(e.to)||!['proposed','verified'].includes(e.status))return false;
      edgeIds.add(e.id);const target=regionMap.get(e.to);
      if(!target)return false;
      if(e.type==='cell-of'){if(!cellMap.get(e.to)?.has(e.from)||target.page.id!==p.id)return false;}
      else if(e.type==='label-in-figure'){if(!labelMap.get(e.to)?.has(e.from)||target.page.id!==p.id)return false;}
      else{const source=regionMap.get(e.from);if(!source||source.page.id!==p.id)return false;}
    }
    if(!Array.isArray(p.issues)||p.issues.length>8192||!p.issues.every(i=>shape(i,['code','pageId','message'],['regionId'])&&id(i.code)&&
      i.pageId===p.id&&typeof i.message==='string'&&(i.regionId===undefined||regionMap.get(i.regionId)?.page.id===p.id)))return false;
    if(p.visualConcernReviews!==undefined){
      const reviews=p.visualConcernReviews;if(!reviews||typeof reviews!=='object'||Array.isArray(reviews)||Object.keys(reviews).some(k=>!VISUAL_PAGE_CONCERNS.includes(k)))return false;
      for(const v of Object.values(reviews))if(!shape(v,['sourceChecked','decision','regionIds'])||typeof v.sourceChecked!=='boolean'||
        !['regions-recorded','no-visible-content'].includes(v.decision)||!ids(v.regionIds,256)||!v.regionIds.every(key=>regionMap.get(key)?.page.id===p.id))return false;
    }
  }
  return true;
}
