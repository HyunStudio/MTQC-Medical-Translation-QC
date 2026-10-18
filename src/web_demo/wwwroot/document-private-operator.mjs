import {mountStructureReview} from './document-structure-review.mjs';
// Private host-only entry point. The public app never imports this module.
const status=document.querySelector('#private-status'),preview=document.querySelector('#document-preview');
const exportButton=document.querySelector('#private-export'),clearButton=document.querySelector('#private-clear');
const reviewButton=document.querySelector('#private-mapping-review'),mappedButton=document.querySelector('#private-mapped-export');
const checklists=document.querySelector('#private-checklists'),mappings=document.querySelector('#private-mappings'),inventory=document.querySelector('#private-mapping-inventory');
let controller,epoch=0,busy=false,active=false;
function buttons(){for(const b of [exportButton,reviewButton,mappedButton])b.disabled=!active||busy;for(const field of [checklists,mappings])field.disabled=!active;}
function invalidate(){epoch++;inventory.textContent='';}
for(const field of [checklists,mappings])field.addEventListener('input',invalidate);
async function mappingRequest(route){
  if(!active||busy)return;
  const snapshot=controller.getReviewSnapshot();if(snapshot.status!=='DRAFT'){status.textContent='Mapping refused: source association unavailable.';return;}
  const started=epoch;busy=true;buttons();
  try{
    const field=route==='mapping-review'?checklists:mappings;
    if(field.value.length>262144)throw Error('Oversized input');
    const payload={snapshot,[route==='mapping-review'?'checklists':'mappings']:JSON.parse(field.value)};
    const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!response.ok)throw Error('Mapping refused');
    const bytes=await response.arrayBuffer();if(bytes.byteLength>1024*1024)throw Error('Oversized response');
    if(!active||epoch!==started)return;
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(result.status!=='DRAFT')throw Error('Mapping refused');
    if(route==='mapping-review'){
      inventory.textContent=JSON.stringify(result,null,2);
      mappings.value=JSON.stringify(result.cases.map(c=>({caseId:c.caseId,checklist:c.checklist,bindings:c.bindings})),null,2);
      status.textContent='ID inventory prepared. Bindings are unreviewed; supply explicit target/canonical IDs after original comparison.';
    }else{
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download='private-mapped-review-DRAFT.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent='Mapped DRAFT downloaded. Human authentication and canonical equivalence remain unverified; no final score or truth lock.';
    }
  }catch{if(active&&epoch===started)status.textContent='Mapping request refused. No download produced.';}
  finally{busy=false;buttons();}
}
reviewButton.addEventListener('click',()=>mappingRequest('mapping-review'));
mappedButton.addEventListener('click',()=>mappingRequest('mapped-export'));
exportButton.addEventListener('click',async()=>{
  if(!active||busy)return;
  const snapshot=controller.getReviewSnapshot();if(snapshot.status!=='DRAFT'){status.textContent='DRAFT export refused: source association unavailable.';return;}
  const started=epoch;busy=true;buttons();
  try{
    const response=await fetch('export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
    if(!response.ok)throw Error('Export refused');
    const bytes=await response.arrayBuffer();if(bytes.byteLength>1024*1024)throw Error('Oversized export');
    if(!active||epoch!==started)return;
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),anchor=document.createElement('a');
    anchor.href=url;anchor.download='private-review-DRAFT.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='DRAFT downloaded. Source bytes checked locally; human authentication, pixel equivalence and canonical mapping remain unverified.';
  }catch{if(epoch===started)status.textContent='DRAFT export refused. No download produced.';}
  finally{busy=false;buttons();}
});
clearButton.addEventListener('click',()=>{
  invalidate();active=false;controller.clear();preview.replaceChildren();document.querySelector('#private-source-identity').textContent='';
  checklists.value='[]';mappings.value='[]';buttons();clearButton.disabled=true;status.textContent='Review cleared. Restart this private host to open the fixed selection again.';
});
try{
  const response=await fetch('bootstrap');if(!response.ok)throw Error('Selection unavailable');
  const data=await response.json();if(data.status!=='DRAFT')throw Error('Intake refused');
  document.querySelector('#private-source-identity').textContent=data.sourcePages.map(p=>`${p.caseId}: physical page ${p.physicalPage} / local ${p.pageId}; PDF SHA256 ${p.sourceSha256}; canonical PNG SHA256 ${p.pageImageSha256}`).join('\n');
  for(const p of data.sourcePages){
    const frame=document.createElement('div');frame.className='document-page-frame';frame.dataset.structurePage=p.pageId;
    const image=document.createElement('img');image.alt=`Parsed original physical page ${p.physicalPage}, local ${p.pageId}`;
    image.src=`preview/${p.pageId}.png`;image.width=p.frame.width;image.height=p.frame.height;frame.append(image);preview.append(frame);await image.decode();
  }
  controller=mountStructureReview({host:document.querySelector('#structure-review'),preview,onChange:invalidate});controller.setPages(data.records,data.sourcePages);
  active=true;buttons();clearButton.disabled=false;
  status.textContent='DRAFT ready for source comparison. Structural action observations do not authenticate a person or measure total human work.';
}catch{
  active=false;preview.replaceChildren();buttons();clearButton.disabled=true;status.textContent='Private intake refused. No editable selection or export available.';
}
