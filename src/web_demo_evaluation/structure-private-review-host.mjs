import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {open,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createSelectedPageReviewDraft} from './structure-selected-page-intake.mjs';
import {createPrivateReviewSnapshot} from '../web_demo/wwwroot/document-private-review-snapshot.mjs';
import {validPrivateDraftSchema} from './structure-private-draft-schema.mjs';
import {validPrivateDraftJournal as validJournal} from './structure-private-draft-envelope.mjs';
import {createPrivateDraftMappingReview,createReviewedArtifactsFromPrivateDraft} from './structure-private-draft-authoring.mjs';
import {MAX_PRIVATE_PDF_BYTES,MAX_PRIVATE_AUX_BYTES} from './structure-private-byte-limits.mjs';

const wwwroot=new URL('../web_demo/wwwroot/',import.meta.url);
const MAX_POST=768*1024, MAX_EXPORT=1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const refused=()=>({status:'ABSTAIN',reason:'INVALID_PRIVATE_DRAFT_EXPORT'});
async function boundedFile(file,maximum){
  const handle=await open(file,'r');
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>maximum)throw Error('Invalid local file size');
    const buffer=Buffer.alloc(maximum+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(!length||length>maximum)throw Error('Invalid local file size');return new Uint8Array(buffer.subarray(0,length));
  }finally{await handle.close();}
}

/** Operator-selected config only; HTTP never accepts filesystem paths. */
export async function loadPrivateReviewConfig(configFile){
  const configPath=await realpath(configFile),base=path.dirname(configPath);
  const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedFile(configPath,32768)));
  if(!exact(config,['sourceFile','selections'])||!Array.isArray(config.selections)||config.selections.length<1||config.selections.length>2||
    !config.selections.every(s=>exact(s,['identity','frame','imageFile'])))throw Error('Invalid private config');
  async function localFile(name,maximum){
    if(typeof name!=='string'||!name||path.isAbsolute(name)||name.includes(':'))throw Error('Relative local files required');
    const resolved=await realpath(path.resolve(base,name)),relative=path.relative(base,resolved);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Local file escapes config directory');
    return boundedFile(resolved,maximum);
  }
  const sourceBytes=await localFile(config.sourceFile,MAX_PRIVATE_PDF_BYTES),selections=[];
  for(const s of config.selections)selections.push({identity:s.identity,frame:s.frame,canonicalImageBytes:await localFile(s.imageFile,MAX_PRIVATE_AUX_BYTES)});
  return {sourceBytes,selections};
}

function editorSection(html){
  const start=html.indexOf('<section id="structure-review"');if(start<0)throw Error('Missing editor template');
  const matcher=/<\/?section\b[^>]*>/g;matcher.lastIndex=start;let depth=0,match;
  while((match=matcher.exec(html))){depth+=match[0].startsWith('</')?-1:1;if(depth===0)return html.slice(start,matcher.lastIndex);}
  throw Error('Invalid editor template');
}

/** Separate ephemeral loopback capability host. No public route, provider, model or truth. */
export async function startPrivateReviewHost(request){
  const intake=await createSelectedPageReviewDraft(request);
  if(intake.status!=='DRAFT')throw Error('Private intake refused');
  const sourcePages=intake.pages.map(p=>({...p.identity,pageId:p.pageId,pdfUserUnit:p.pdfUserUnit,frame:p.frame,
    nativeFragmentIds:p.nativeFragments.map(f=>f.id),sourceRenderEquivalence:p.sourceRenderEquivalence,canonicalFragmentCrosswalk:p.canonicalFragmentCrosswalk}));
  const previews=intake.pages.map(p=>({pageId:p.pageId,previewSha256:p.previewSha256}));
  const fixedIntake={sourceBytes:intake.sourceBytes,selections:intake.pages.map(p=>({identity:p.identity,frame:p.frame,canonicalImageBytes:p.canonicalImageBytes}))};
  const bootstrap={status:'DRAFT',sourcePageCount:intake.sourcePageCount,renderer:intake.renderer,sourcePages,
    records:intake.pages.map(p=>p.record),document:intake.document,previews,manualReview:intake.manualReview};
  // Entire parsed selection stays private; responses serialize copies, never expose held bytes.
  const assets=new Map();
  for(const file of ['document-structure-review.mjs','document-structure.mjs','document-structure-proposal.mjs','document-layout.mjs',
    'document-render-limits.mjs','document-private-review-snapshot.mjs','document-private-interaction-journal.mjs','document-structure-review.css',
    'document-private-operator.mjs','document-private-operator.css'])assets.set(file,await readFile(new URL(file,wwwroot)));
  const editor=editorSection(await readFile(new URL('index.html',wwwroot),'utf8'));
  const mappingSection=`<section aria-label="Explicit ID mapping"><h2>ID mapping · DRAFT</h2><p>Supply separately prepared checklist IDs and kinds for every selected case. Compare targets with the original before editing bindings. Declared review flags do not authenticate human review.</p><label for="private-checklists">Checklist JSON (caseId, checklist with id and kind only)</label><textarea id="private-checklists" maxlength="262144" disabled>[]</textarea><button id="private-mapping-review" type="button" disabled>Prepare ID inventory</button><pre id="private-mapping-inventory" aria-label="Source-linked ID inventory"></pre><label for="private-mappings">Mapping JSON (caseId, checklist, bindings)</label><textarea id="private-mappings" maxlength="262144" disabled>[]</textarea><button id="private-mapped-export" type="button" disabled>Download mapped DRAFT</button></section>`;
  const html=Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private source review · DRAFT</title><link rel="stylesheet" href="document-structure-review.css"><link rel="stylesheet" href="document-private-operator.css"></head><body><main><h1>Private source review · DRAFT</h1><p>Parsed source preview. Canonical image equivalence unverified; native-to-canonical mapping unavailable. Decisions remain reviewer drafts. Actor authentication and human work metrics unavailable.</p><p id="private-source-identity"></p><p id="private-status" role="status">Loading fixed selection…</p><div id="document-preview" class="document-source-preview"></div>${editor}<button id="private-export" type="button" disabled>Download DRAFT review</button><button id="private-clear" type="button" disabled>Clear review</button>${mappingSection}</main><script type="module" src="document-private-operator.mjs"></script></body></html>`);
  const prefix='/'+randomBytes(24).toString('hex')+'/';let origin,mappingBusy=false;
  const server=http.createServer({maxHeaderSize:8192},async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    function send(code,body,type='application/json',extra={}){res.writeHead(code,{...headers,'Content-Type':type,...extra});res.end(type==='application/json'?JSON.stringify(body):body);}
    try{
      if(req.headers.host!==new URL(origin).host|| (req.headers.origin&&req.headers.origin!==origin)||
        (req.headers['sec-fetch-site']&& !['none','same-origin'].includes(req.headers['sec-fetch-site'])))return send(403,refused());
      const route=req.url?.startsWith(prefix)?req.url.slice(prefix.length):null;
      if(route===null)return send(404,refused());
      if(!['GET','POST'].includes(req.method))return send(405,refused());
      if(req.method==='GET'){
        if(route==='')return send(200,html,'text/html; charset=utf-8');
        if(route==='bootstrap')return send(200,bootstrap);
        if(assets.has(route))return send(200,assets.get(route),route.endsWith('.css')?'text/css':'text/javascript');
        const page=intake.pages.find(p=>route===`preview/${p.pageId}.png`);
        if(page)return send(200,Buffer.from(page.previewPngBytes),'image/png');
        return send(404,refused());
      }
      if(!['export','mapping-review','mapped-export'].includes(route))return send(404,refused());
      if(req.headers.origin!==origin)return send(403,refused());
      if(req.headers['content-type']!=='application/json')return send(415,refused());
      if(Number(req.headers['content-length'])>MAX_POST)return send(413,refused());
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>MAX_POST)return send(413,refused());chunks.push(chunk);}
      const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(route!=='export'&&!exact(payload,['snapshot',route==='mapping-review'?'checklists':'mappings']))return send(422,refused());
      const value=route==='export'?payload:payload.snapshot;
      if(!exact(value,['status','document','sourcePages','sourceGeneration','manualReview','interactionJournal'])||value.status!=='DRAFT'||value.sourceGeneration!==1||
        !isDeepStrictEqual(value.sourcePages,sourcePages)||!isDeepStrictEqual(value.manualReview,intake.manualReview)||
        !validJournal(value.interactionJournal,sourcePages.map(p=>p.pageId)))return send(422,refused());
      const captured=createPrivateReviewSnapshot({document:value.document,sourcePages:value.sourcePages,sourceGeneration:value.sourceGeneration});
      if(captured.status!=='DRAFT'||!validPrivateDraftSchema(captured.document)||intake.pages.some(p=>hash(intake.sourceBytes)!==p.identity.sourceSha256||
        hash(p.canonicalImageBytes)!==p.identity.pageImageSha256||hash(p.previewPngBytes)!==p.previewSha256))return send(422,refused());
      const draft={schemaVersion:1,artifactKind:'private-operator-review-draft',status:'DRAFT',actorAuthentication:'unavailable',
        sourcePageCount:intake.sourcePageCount,renderer:intake.renderer,sourcePages:captured.sourcePages,previews,
        document:captured.document,sourceGeneration:captured.sourceGeneration,manualReview:captured.manualReview,
        interactionJournal:value.interactionJournal};
      const bytes=Buffer.from(JSON.stringify(draft));if(bytes.length>MAX_EXPORT)return send(422,refused());
      if(route!=='export'){
        if(mappingBusy)return send(409,{status:'ABSTAIN',reason:'PRIVATE_MAPPING_REVIEW_BUSY'});
        mappingBusy=true;
        try{
          const input={draftBytes:new Uint8Array(bytes),intakeRequest:fixedIntake};
          const result=route==='mapping-review'?await createPrivateDraftMappingReview({...input,checklists:payload.checklists}):
            await createReviewedArtifactsFromPrivateDraft({...input,mappings:payload.mappings});
          if(result.status!=='DRAFT')return send(422,result);
          const output=route==='mapping-review'?result:{schemaVersion:1,artifactKind:'private-mapped-operator-review-draft',...result};
          const outputBytes=Buffer.from(JSON.stringify(output));if(outputBytes.length>MAX_EXPORT)return send(422,refused());
          return route==='mapping-review'?send(200,output):send(200,outputBytes,'application/octet-stream',{'Content-Disposition':'attachment; filename="private-mapped-review-DRAFT.json"'});
        }finally{mappingBusy=false;}
      }
      return send(200,bytes,'application/octet-stream',{'Content-Disposition':'attachment; filename="private-review-DRAFT.json"'});
    }catch{return send(422,refused());}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:origin+prefix,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3)throw Error('Usage: node structure-private-review-host.mjs <operator-selection.json>');
    const host=await startPrivateReviewHost(await loadPrivateReviewConfig(process.argv[2]));
    process.stdout.write(`Private DRAFT review: ${host.url}\n`);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{host.close().then(()=>process.exit(0));});
  }catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
