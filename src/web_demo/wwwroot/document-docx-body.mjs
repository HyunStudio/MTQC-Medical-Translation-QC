// A source-bound adapter for the existing local desktop document engine.
export const isLocalDocumentOrigin=()=>['http:','https:'].includes(location.protocol)&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const markers=text=>text.match(/⟦MTQC_\d{4}⟧/gu)||[];
export function validInlineTarget(contract,target) {
  const expected=markers(contract),actual=markers(target);
  return Boolean(target.replace(/⟦MTQC_\d{4}⟧/gu,'').trim()) && expected.length===actual.length && expected.every((v,i)=>v===actual[i]) &&
    (!expected.length||target.startsWith(expected[0])) && !target.replace(/⟦MTQC_\d{4}⟧/gu,'').includes('⟦MTQC_');
}
function base64(bytes) { let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value); }
export function mountDocxBody({host,translate,available,targetLanguage,save=defaultSave}) {
  const doc=host.ownerDocument;
  const element=(tag,text)=>{const node=doc.createElement(tag);if(text)node.textContent=text;return node;};
  const title=element('h3','Document text and native equations');
  const note=element('p','Open the document with the local app to review body, table, header and footer text. Native Word equations stay in their existing document nodes. This does not recognize scanned equations or verify Word page layout.');
  const open=element('button','Open text in local app');open.type='button';open.dataset.docxBodyAction='open';
  const status=element('p');status.setAttribute('role','status');
  const editor=element('div');editor.hidden=true;
  const select=element('select');select.setAttribute('aria-label','Document text unit');select.dataset.docxBody='unit';
  const source=element('textarea');source.readOnly=true;source.rows=4;source.setAttribute('aria-label','Original document text');
  const target=element('textarea');target.rows=4;target.setAttribute('aria-label','Reviewed document target');target.dataset.docxBody='target';
  const sourceLabel=element('label'),sourceChecked=element('input');sourceChecked.type='checkbox';sourceChecked.dataset.docxBody='source-reviewed';sourceLabel.append(sourceChecked,' I checked the source text against the document.');
  const send=element('button','Translate selected text');send.type='button';send.dataset.docxBodyAction='translate';
  const targetLabel=element('label'),reviewed=element('input');reviewed.type='checkbox';reviewed.dataset.docxBody='target-reviewed';targetLabel.append(reviewed,' I reviewed this target and kept the inline markers in order.');
  const apply=element('button','Use reviewed target');apply.type='button';apply.dataset.docxBodyAction='apply';
  const keep=element('button','Keep original text');keep.type='button';keep.dataset.docxBodyAction='keep-original';
  const download=element('button','Download text draft (figure edits not included)');download.type='button';download.dataset.docxBodyAction='download';
  editor.append(select,source,sourceLabel,send,target,targetLabel,apply,keep,download);
  host.append(title,note,open,status,editor);host.hidden=true;
  let bytes=null,model=null,targets=new Map(),epoch=0,revision=0,busy=false,controller=null;
  const unit=()=>model?.units.find(u=>u.id===select.value);
  const sourceText=u=>u.inlineContract||u.text;
  function refresh(){send.disabled=busy||!unit()||!sourceChecked.checked||!available()||Array.from(source.value).length>3000;apply.disabled=busy||!unit()||!reviewed.checked||!validInlineTarget(unit()?.inlineContract||'',target.value);keep.disabled=busy||!unit()||!targets.has(unit().id);download.disabled=busy||!targets.size;open.disabled=busy||!bytes||!isLocalDocumentOrigin();}
  function choose(){revision++;const u=unit();source.value=u?sourceText(u):'';target.value=u?(targets.get(u.id)||''):'';sourceChecked.checked=false;reviewed.checked=false;refresh();}
  async function post(path,payload,signal){if(!isLocalDocumentOrigin())throw Error('Open the local app on localhost to process document text. The document has not been uploaded.');const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw Error(error||'Local document service is unavailable. Start the local app; no provider request was sent.');}return response;}
  async function inspect(input,signal){return(await post('/api/local/docx/inspect',{sourceBase64:base64(input)},signal)).json();}
  function clear(){epoch++;revision++;controller?.abort();controller=null;bytes=null;model=null;targets.clear();busy=false;editor.hidden=true;host.hidden=true;status.textContent='';select.replaceChildren();source.value='';target.value='';sourceChecked.checked=false;reviewed.checked=false;refresh();}
  async function setFile(input){clear();bytes=new Uint8Array(input);host.hidden=false;status.textContent=isLocalDocumentOrigin()?'The file stays in this browser until you choose Open text in local app. That action sends it only to this computer’s local document service.':'Document text processing is available in the local app on localhost. This page keeps the document in the browser; source bytes are not uploaded.';refresh();}
  open.addEventListener('click',async()=>{if(busy||!bytes||!isLocalDocumentOrigin())return;const ticket=epoch;controller=new AbortController();busy=true;refresh();try{const result=await inspect(bytes,controller.signal);if(ticket!==epoch)return;model=result;targets.clear();select.replaceChildren(...result.units.map((u,i)=>{const option=element('option',`${i+1}. ${u.layoutRole} · ${u.text.slice(0,70)}`);option.value=u.id;return option;}));editor.hidden=false;choose();status.textContent=`${result.units.length} text units; ${result.nativeEquationCount} native equation(s) retained. Enter a target or explicitly translate one reviewed unit. Inline markers delimit text runs around native content. Targets are drafts until you inspect the exported Word document.`;}catch(error){if(ticket===epoch)status.textContent=error.message;}finally{if(ticket===epoch){busy=false;refresh();}}});
  select.addEventListener('change',choose);
  sourceChecked.addEventListener('change',()=>{revision++;refresh();});
  target.addEventListener('input',()=>{revision++;reviewed.checked=false;refresh();});
  reviewed.addEventListener('change',()=>{revision++;refresh();});
  send.addEventListener('click',async()=>{if(send.disabled)return;const ticket=epoch,version=revision,u=unit();busy=true;refresh();try{const result=await translate({sourceText:sourceText(u),targetLanguage:targetLanguage()});if(ticket!==epoch||version!==revision)return;if(!result?.complete||!validInlineTarget(u.inlineContract,result.translation||''))throw Error('Translation is incomplete or its inline markers changed. Review the source; no target was applied.');target.value=result.translation;reviewed.checked=false;status.textContent='Draft received. Review the target before choosing Use reviewed target.';}catch(error){if(ticket===epoch)status.textContent=error.message;}finally{if(ticket===epoch){busy=false;refresh();}}});
  apply.addEventListener('click',()=>{if(apply.disabled)return;targets.set(unit().id,target.value);revision++;reviewed.checked=false;status.textContent=`${targets.size} reviewed target(s) selected. Unselected text retains its original runs. Figure DOCX export also includes these selected targets.`;refresh();});
  keep.addEventListener('click',()=>{if(keep.disabled)return;targets.delete(unit().id);revision++;target.value='';reviewed.checked=false;status.textContent=`Original text retained for this unit. ${targets.size} reviewed target(s) selected.`;refresh();});
  async function applyTo(input){if(!targets.size)return{bytes:input,changedText:0};if(busy)throw Error('Finish the current document text action before export.');const ticket=epoch,version=revision,captured=new Map(targets),original=model;const inspected=await inspect(input);if(ticket!==epoch||version!==revision)throw Error('Document text changed during export.');if(JSON.stringify(inspected.units)!==JSON.stringify(original.units))throw Error('Figure export changed the source text binding.');const response=await post('/api/local/docx/apply',{sourceBase64:base64(input),sourceSha256:inspected.sourceSha256,targets:Object.fromEntries(captured)});const output=new Uint8Array(await response.arrayBuffer());if(ticket!==epoch||version!==revision)throw Error('Document text changed during export.');return{bytes:output,changedText:captured.size};}
  download.addEventListener('click',async()=>{if(download.disabled)return;const ticket=epoch;download.disabled=true;try{const result=await applyTo(bytes);if(ticket===epoch){save(new Blob([result.bytes],{type:mime}),'mtqc-text-draft.docx');status.textContent=`Text draft downloaded with ${result.changedText} selected target(s). Inspect equation positions, line breaks and page layout in Word. Figure edits are not included in this text-only download.`;}}catch(error){if(ticket===epoch)status.textContent=error.message;}finally{if(ticket===epoch)refresh();}});
  return Object.freeze({setFile,clear,applyTo,refresh,snapshot:()=>({loaded:Boolean(model),selectedTargets:targets.size,units:model?.units.length||0,nativeEquations:model?.nativeEquationCount||0})});
}
function defaultSave(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
