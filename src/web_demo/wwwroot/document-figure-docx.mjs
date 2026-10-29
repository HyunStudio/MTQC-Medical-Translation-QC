import './vendor/jszip/jszip.min.mjs';
// Main-body PNG and bounded BMP exact crop/quarter-turn or unrotated crop/mirror revision. Edits become named
// PNG parts with explicit relationship/content-type retargeting; body/placement stay intact.
const Zip=globalThis.JSZip,sessions=new WeakMap();
const MAX_INPUT=10*1024*1024,MAX_TOTAL=48*1024*1024,MAX_XML=2*1024*1024,MAX_IMAGES=32,MAX_PIXELS=12_000_000;
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',REL='http://schemas.openxmlformats.org/package/2006/relationships';
const CT='http://schemas.openxmlformats.org/package/2006/content-types',IMAGE=R+'/image';
const fail=reason=>{throw new Error('DOCX figure revision held: '+reason);};
// OPC part paths are arbitrary: admission must inspect declared capabilities,
// not just the usual Word filenames. These packages are retained, never sanitized.
const activeRelationship=/\/(?:oleObject|package|control|activeXControlBinary|vbaProject|vbaData|aFChunk|attachedTemplate|webextension|webextensiontaskpanes|ui\/extensibility|digital-signature\/[^/]+)$/i;
const activeContentType=/(?:macroEnabled|vbaProject|vbaData|oleObject|activeX|digital-signature|webextension)/i;
const hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function safeName(name){
 if(!name||name.startsWith('/')||/[\\%:#?]|[^\x20-\x7e]/u.test(name))return false;
 const parts=name.replace(/\/$/,'').split('/');
 return parts.every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p));
}
function extra(bytes,start,length){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=start+length;
 for(let p=start;p<end;){if(p+4>end)fail('invalid ZIP extra field');const id=v.getUint16(p,true),n=v.getUint16(p+2,true);if(id===1)fail('ZIP64 unsupported');p+=4+n;if(p>end)fail('invalid ZIP extra field');}
}
function inspectZip(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_INPUT)fail('input size or bytes');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=new TextDecoder('utf-8',{fatal:true});let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
 if(end<0)fail('missing ZIP directory');
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
 if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||!count||count>512||count===0xffff||size===0xffffffff||offset===0xffffffff||offset+size!==end)fail('ZIP32 directory bounds');
 const entries=[],names=new Set();let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||v.getUint32(p,true)!==0x02014b50)fail('invalid ZIP entry');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),length=v.getUint32(p+24,true);
  const n=v.getUint16(p+28,true),x=v.getUint16(p+30,true),c=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
  if(!n||p+46+n+x+c>end||v.getUint16(p+34,true)||[compressed,length,local].includes(0xffffffff)||flags&~0x080e||![0,8].includes(method))fail('encrypted or unsupported ZIP entry');
  let name;try{name=ascii.decode(bytes.subarray(p+46,p+46+n));}catch{fail('ZIP filename encoding');}
  if(!safeName(name)||names.has(name.toLowerCase()))fail('duplicate or unsafe ZIP name');names.add(name.toLowerCase());
  if(/^_xmlsignatures\//i.test(name)||/^word\/(?:vbaProject\.bin|activeX\/|embeddings\/)/i.test(name))fail('signed or active package');
  total+=length;if(total>MAX_TOTAL||(/\.(?:xml|rels)$/i.test(name)&&length>MAX_XML))fail('decompressed package or XML size');
  extra(bytes,p+46+n,x);
  entries.push({name,flags,method,crc,compressed,length,local});p+=46+n+x+c;
 }
 if(p!==end)fail('ZIP directory length');
 const sorted=[...entries].sort((a,b)=>a.local-b.local);if(sorted[0].local!==0)fail('ZIP prefix unsupported');
 for(let i=0;i<sorted.length;i++){
  const e=sorted[i],p=e.local,next=sorted[i+1]?.local??offset;
  if(p+30>next||v.getUint32(p,true)!==0x04034b50||v.getUint16(p+6,true)!==e.flags||v.getUint16(p+8,true)!==e.method)fail('ZIP local parent mismatch');
  const n=v.getUint16(p+26,true),x=v.getUint16(p+28,true),data=p+30+n+x;
  if(data>next||data+e.compressed>next||ascii.decode(bytes.subarray(p+30,p+30+n))!==e.name)fail('ZIP local name or payload mismatch');
  extra(bytes,p+30+n,x);
  e.dataOffset=data;
  const tail=data+e.compressed;
  if(e.flags&8){
   let d=tail;if(next-tail===16&&v.getUint32(d,true)===0x08074b50)d+=4;
   if(next-d!==12||v.getUint32(d,true)!==e.crc||v.getUint32(d+4,true)!==e.compressed||v.getUint32(d+8,true)!==e.length)fail('ZIP data descriptor mismatch');
  }else if(tail!==next||v.getUint32(p+14,true)!==e.crc||v.getUint32(p+18,true)!==e.compressed||v.getUint32(p+22,true)!==e.length)fail('ZIP local sizes or CRC mismatch');
 }
 return entries;
}
const crcTable=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
async function unpack(bytes,entry){
 const compressed=bytes.subarray(entry.dataOffset,entry.dataOffset+entry.compressed);
 let result;
 if(entry.method===0){if(entry.compressed!==entry.length)fail('stored entry length');result=compressed.slice();}
 else{
  // Do not ask an archive library to inflate attacker-controlled data in full
  // before checking its declared size. Feed small compressed chunks and stop
  // the reader as soon as the captured central-directory bound is exceeded.
  let offset=0,reader;const chunks=[];let total=0;
  try{
   const stream=new ReadableStream({pull(controller){if(offset===compressed.length){controller.close();return;}const end=Math.min(compressed.length,offset+1024);controller.enqueue(compressed.slice(offset,end));offset=end;}});
   reader=stream.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
   while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>entry.length||total>MAX_TOTAL)fail('decompression limit');chunks.push(value);}
   if(total!==entry.length)fail('decompressed entry length');result=new Uint8Array(total);let p=0;for(const chunk of chunks){result.set(chunk,p);p+=chunk.length;}
  }catch(error){fail(error.message?.includes('decompression limit')?'decompression limit':'unsupported or invalid compressed entry');}
  finally{if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
 }
 if(crc(result)!==entry.crc)fail('ZIP payload CRC');return result;
}
function pngInfo(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<45||bytes.length>MAX_INPUT||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))fail('invalid PNG bytes');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0,idat=false,ended=false;
 for(let p=8;p<bytes.length;){
  if(p+12>bytes.length)fail('PNG chunk bounds');const n=v.getUint32(p),t=String.fromCharCode(...bytes.subarray(p+4,p+8)),end=p+n+12;
  if(end>bytes.length||crc(bytes.subarray(p+4,p+8+n))!==v.getUint32(p+8+n))fail('PNG chunk CRC');
  if(p===8){if(t!=='IHDR'||n!==13)fail('PNG header');width=v.getUint32(p+8);height=v.getUint32(p+12);if(!width||!height||width>32767||height>32767||width*height>MAX_PIXELS)fail('PNG pixel limit');}
  else if(t==='IHDR')fail('duplicate PNG header');
  if(t==='acTL')fail('animated PNG unsupported');if(t==='IDAT')idat=true;
  if(t==='IEND'){if(n||end!==bytes.length)fail('PNG end');ended=true;break;}p=end;
 }
 if(!ended||!idat)fail('incomplete PNG');return {width,height};
}
// The finite BMP subset is deliberately narrower than the Windows format.
function bmpInfo(bytes){
 const hold=detail=>fail('unsupported BMP: '+detail);
 if(!(bytes instanceof Uint8Array)||bytes.length<54||bytes.length>MAX_INPUT)hold('size');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.getUint16(0,true)!==0x4d42||v.getUint32(2,true)!==bytes.length||v.getUint16(6,true)||v.getUint16(8,true)||v.getUint32(10,true)!==54||v.getUint32(14,true)!==40)hold('file or information header');
 const width=v.getInt32(18,true),height=v.getInt32(22,true);
 if(width<1||height<1||width>32767||height>32767||width*height>MAX_PIXELS)hold('bottom-up dimensions');
 const stride=Math.ceil(width*3/4)*4,length=stride*height;
 if(v.getUint16(26,true)!==1||v.getUint16(28,true)!==24||v.getUint32(30,true)!==0||v.getUint32(34,true)!==length||v.getInt32(38,true)||v.getInt32(42,true)||v.getUint32(46,true)||v.getUint32(50,true)||54+length!==bytes.length)hold('encoding, metadata or payload bounds');
 for(let y=0;y<height;y++)for(let x=width*3;x<stride;x++)if(bytes[54+y*stride+x])hold('nonzero padding');
 return{width,height,stride};
}
async function bmpPng(bytes,info){
 const canvas=document.createElement('canvas');canvas.width=info.width;canvas.height=info.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(info.width,info.height);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const s=54+(info.height-1-y)*info.stride+x*3,d=(y*info.width+x)*4;image.data[d]=bytes[s+2];image.data[d+1]=bytes[s+1];image.data[d+2]=bytes[s];image.data[d+3]=255;}
 ctx.putImageData(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)fail('BMP PNG encoding');return new Uint8Array(await blob.arrayBuffer());
}
async function decodePng(bytes,info){
 let image;try{image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));if(image.width!==info.width||image.height!==info.height)fail('decoded image dimensions');return image;}catch{image?.close();fail('PNG decode');}
}
function xml(bytes,kind){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('XML UTF-8 encoding');}
 if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('XML declarations');const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.getElementsByTagName('parsererror').length||doc.documentElement.localName!==kind)fail('invalid '+kind+' XML');return doc;
}
function relations(bytes){
 const doc=xml(bytes,'Relationships');if(doc.documentElement.namespaceURI!==REL)fail('relationship namespace');const result=new Map();
 for(const r of doc.documentElement.children){if(r.namespaceURI!==REL||r.localName!=='Relationship')fail('relationship child');const id=r.getAttribute('Id'),type=r.getAttribute('Type');if(!id||result.has(id))fail('duplicate relationship id');if(activeRelationship.test(type))fail('signed or active relationship');result.set(id,{type,target:r.getAttribute('Target'),mode:r.getAttribute('TargetMode')});}return result;
}
function resolveTarget(rels,target){
 if(!target||/[\\%?#:]/u.test(target))fail('unsupported relationship target');
 const source=rels==='_rels/.rels'?'':rels.replace(/(^|\/)_rels\//,'$1').slice(0,-5),base=source.slice(0,source.lastIndexOf('/')+1);
 const url=new URL(target,'https://mtqc.invalid/'+base),part=url.pathname.slice(1);
 if(url.origin!=='https://mtqc.invalid'||!safeName(part))fail('external or unsafe relationship target');return part;
}
function assertDrawingGeometry(blip,body,checked,forceSimple=false){
 // Bind an admitted source rectangle to this selected picture, never a sibling.
 const hold=detail=>fail('unsupported drawing geometry: '+detail);
 const pictureNS='http://schemas.openxmlformats.org/drawingml/2006/picture',wordDrawingNS='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',groupNS='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
 const is=(node,ns,name)=>node?.namespaceURI===ns&&node.localName===name;
 const children=(node,ns,name)=>[...node.children].filter(n=>is(n,ns,name));
 let picture=blip.parentElement;
 while(picture&&picture!==body&&!is(picture,pictureNS,'pic'))picture=picture.parentElement;
 if(!picture||picture===body)hold('unknown picture parent');
 const fill=blip.parentElement;
 if(!is(fill,pictureNS,'blipFill')||fill.parentElement!==picture)hold('unknown picture fill parent');
 if(children(picture,pictureNS,'blipFill').length!==1)hold('ambiguous picture fill');
 let drawing=picture.parentElement;
 while(drawing&&drawing!==body&&!is(drawing,W,'drawing'))drawing=drawing.parentElement;
 if(!drawing||drawing===body)hold('missing Word drawing parent');
 if(children(fill,A,'blip').length!==1)hold('ambiguous picture image reference');
 if(checked.has(picture))return checked.get(picture);
 // XML Schema whitespace excludes NBSP, FEFF and other JS trim characters.
 const xmlTrim=value=>value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,'');
 const zero=value=>/^[+-]?0+$/.test(xmlTrim(value));
 const attributes=(node,allowed)=>{for(const attr of node.attributes){if(attr.namespaceURI==='http://www.w3.org/2000/xmlns/')continue;if(attr.namespaceURI||!allowed.includes(attr.localName))hold('unknown '+node.localName+' attribute');}};
 const sourceRects=[...fill.getElementsByTagNameNS(A,'srcRect')];
 if(sourceRects.length>1||sourceRects.some(n=>n.parentElement!==fill))hold('ambiguous source rectangle');
 const crop={l:0,t:0,r:0,b:0};
 for(const rect of sourceRects){attributes(rect,['l','t','r','b']);if(rect.children.length)hold('source rectangle children');for(const key of ['l','t','r','b'])if(rect.hasAttribute(key)){const text=xmlTrim(rect.getAttribute(key));if(!/^[+-]?[0-9]+$/.test(text))hold('malformed source rectangle');const value=Number(text);if(!Number.isSafeInteger(value)||value<0||value>100000)hold('source rectangle range');crop[key]=value;}}
 if(crop.l+crop.r>=100000||crop.t+crop.b>=100000)hold('empty source rectangle');
 for(const rect of fill.getElementsByTagNameNS(A,'fillRect')){attributes(rect,['l','t','r','b']);for(const key of ['l','t','r','b'])if(rect.hasAttribute(key)&&!zero(rect.getAttribute(key)))hold('cropped or malformed fill rectangle');}
 const cropped=Object.values(crop).some(Boolean),properties=children(picture,pictureNS,'spPr');
 if(properties.length!==1)hold('unknown picture transform parent');
 const ownTransforms=children(properties[0],A,'xfrm');if(ownTransforms.length>1)hold('ambiguous picture transform');
 let rotation=0;
 if(ownTransforms[0]?.hasAttribute('rot')){const text=xmlTrim(ownTransforms[0].getAttribute('rot')),value=Number(text);if(!/^[+-]?[0-9]+$/.test(text)||!Number.isSafeInteger(value)||![0,5400000,10800000,16200000].includes(value))hold('unsupported or malformed picture rotation');rotation=value/60000;}
 const flipValue=text=>{text=xmlTrim(text);if(!['true','1','false','0'].includes(text))hold('malformed picture flip');return text==='true'||text==='1';};
 const flipH=ownTransforms[0]?.hasAttribute('flipH')?flipValue(ownTransforms[0].getAttribute('flipH')):false,flipV=ownTransforms[0]?.hasAttribute('flipV')?flipValue(ownTransforms[0].getAttribute('flipV')):false;
 if(forceSimple&&(flipH||flipV)&&rotation)hold('BMP mirror with rotation unsupported');
 if(forceSimple){const transform=ownTransforms[0];if(ownTransforms.length!==1)hold('unknown BMP transform');const off=children(transform,A,'off'),ext=children(transform,A,'ext');if(off.length!==1||ext.length!==1||transform.children.length!==2)hold('unknown BMP transform children');attributes(off[0],['x','y']);attributes(ext[0],['cx','cy']);if(off[0].children.length||ext[0].children.length||!['x','y'].every(k=>off[0].hasAttribute(k)&&zero(off[0].getAttribute(k)))||!['cx','cy'].every(k=>{const t=xmlTrim(ext[0].getAttribute(k)||'');return /^[+]?[0-9]+$/.test(t)&&Number.isSafeInteger(Number(t))&&Number(t)>0;}))hold('unknown BMP offsets or extents');}
 const mapped=cropped||rotation!==0||flipH||flipV||forceSimple;
 if(mapped){
  // Only a simple rectangular picture stretched over its retained placement.
  // Effects, grouped coordinates and alternative fill semantics need their own mapping.
  attributes(fill,[]);for(const attr of blip.attributes)if(attr.namespaceURI!=='http://www.w3.org/2000/xmlns/'&&!(attr.namespaceURI===R&&attr.localName==='embed'))hold('unknown cropped blip attribute');
  for(const attr of blip.attributes)if(attr.namespaceURI&&attr.namespaceURI!==R&&attr.namespaceURI!=='http://www.w3.org/2000/xmlns/')hold('unknown cropped blip attribute');
  if(blip.children.length)hold('cropped picture effects');
  const stretches=children(fill,A,'stretch');
  if(children(fill,A,'blip').length!==1||stretches.length!==1||[...fill.children].some(n=>!is(n,A,'blip')&&!is(n,A,'srcRect')&&!is(n,A,'stretch')))hold('unknown cropped fill children');
  attributes(stretches[0],[]);const rects=children(stretches[0],A,'fillRect');if(rects.length!==1||stretches[0].children.length!==1||rects[0].children.length)hold('unknown cropped stretch');
 }
 if(fill.getElementsByTagNameNS(A,'tile').length)hold('tiled picture fill');
 if(mapped){const property=properties[0],geometries=children(property,A,'prstGeom');attributes(property,[]);if(geometries.length!==1||geometries[0].getAttribute('prst')!=='rect'||[...property.children].some(n=>!is(n,A,'xfrm')&&!is(n,A,'prstGeom'))||children(property,A,'xfrm').length>1)hold('nonrectangular or effect-bearing cropped picture');attributes(geometries[0],['prst']);if([...geometries[0].children].some(n=>!is(n,A,'avLst')||n.children.length))hold('adjusted cropped geometry');}

 // A sibling shape's transform does not transform this picture. Only the
 // selected picture and groups on its ancestor path supply its transforms.
 for(let node=picture.parentElement;node!==drawing;node=node.parentElement){
  if(is(node,A,'grpSp')||(node?.namespaceURI===groupNS&&['wgp','grpSp'].includes(node.localName))){
   if(mapped)hold('grouped crop or rotation unsupported');const props=[...children(node,A,'grpSpPr'),...children(node,groupNS,'grpSpPr')];
   if(props.length!==1)hold('unknown group transform parent');properties.push(props[0]);
  }else if(!((node?.namespaceURI===A&&['graphic','graphicData'].includes(node.localName))||(node?.namespaceURI===wordDrawingNS&&['inline','anchor'].includes(node.localName))))hold('unknown picture container');
 }
 for(const property of properties)for(const transform of property.getElementsByTagNameNS(A,'xfrm')){
  attributes(transform,['rot','flipH','flipV']);
  if(transform.hasAttribute('rot')&&!zero(transform.getAttribute('rot'))&&!(property===properties[0]&&transform===ownTransforms[0]&&rotation))hold('unsupported ancestor or malformed picture rotation');
  for(const key of ['flipH','flipV'])if(transform.hasAttribute(key)&&flipValue(transform.getAttribute(key))&&(property!==properties[0]||transform!==ownTransforms[0]))hold('ancestor mirror unsupported');
 }
 const result=Object.freeze({crop:Object.freeze(crop),rotation,flipH,flipV});checked.set(picture,result);return result;
}
function cropView(crop,info){
 const hold=reason=>fail('unsupported drawing geometry: '+reason);
 const edge=(value,size)=>{const product=value*size;if(product%100000)hold('fractional source pixel mapping');return product/100000;};
 const x=edge(crop.l,info.width),y=edge(crop.t,info.height),right=edge(crop.r,info.width),bottom=edge(crop.b,info.height);return Object.freeze({x,y,width:info.width-x-right,height:info.height-y-bottom});
}
function assertCropPng(bytes){
 const hold=reason=>fail('unsupported drawing geometry: '+reason),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes[24]!==8||![2,6].includes(bytes[25]))hold('crop requires eight-bit RGB or RGBA PNG');
 for(let p=8;p<bytes.length;){const n=v.getUint32(p),kind=String.fromCharCode(...bytes.subarray(p+4,p+8));if(['iCCP','gAMA','cHRM','sRGB','cICP','mDCv','cLLi','tRNS','eXIf'].includes(kind))hold('crop PNG color, orientation or transparency metadata unsupported');p+=n+12;}
}

export async function readDocxFigures(input){
 if(!(input instanceof Uint8Array))fail('unknown source bytes');const snapshot=input.slice(),inventory=inspectZip(snapshot);
 const zip=await Zip.loadAsync(snapshot,{checkCRC32:false,createFolders:false}),parts=new Map();
 if(Object.keys(zip.files).length!==inventory.length||inventory.some(e=>!Object.hasOwn(zip.files,e.name)))fail('ZIP entry normalization');
 for(const e of inventory)parts.set(e.name,await unpack(snapshot,e));
 const required=n=>{const b=parts.get(n);if(!b)fail('missing '+n);return b;};
 const types=xml(required('[Content_Types].xml'),'Types');if(types.documentElement.namespaceURI!==CT)fail('content type namespace');
 const overrides=new Map(),defaults=new Map();
 for(const n of types.documentElement.children){const key=n.getAttribute(n.localName==='Override'?'PartName':'Extension'),map=n.localName==='Override'?overrides:defaults;if(n.namespaceURI!==CT||!['Override','Default'].includes(n.localName)||!key||map.has(key))fail('content type entries');const type=n.getAttribute('ContentType');if(activeContentType.test(type))fail('signed or active content type');map.set(key,type);}
 if(overrides.get('/word/document.xml')!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')fail('unsupported Word main type');
 const root=relations(required('_rels/.rels')),roots=[...root.values()].filter(r=>r.type===R+'/officeDocument');
 if(roots.length!==1||roots[0].mode==='External'||resolveTarget('_rels/.rels',roots[0].target)!=='word/document.xml')fail('unknown main document parent');
 const main=xml(required('word/document.xml'),'document');if(main.documentElement.namespaceURI!==W)fail('Word namespace');
 const bodies=main.getElementsByTagNameNS(W,'body');if(bodies.length!==1)fail('unknown Word body');const body=bodies[0];
 if(body.getElementsByTagNameNS('urn:schemas-microsoft-com:vml','imagedata').length)fail('VML images unsupported');
 const rels=relations(required('word/_rels/document.xml.rels')),selected=new Map(),checkedDrawings=new Map();
 for(const blip of body.getElementsByTagNameNS(A,'blip')){
  if(blip.getAttributeNS(R,'link'))fail('linked image unsupported');const id=blip.getAttributeNS(R,'embed'),r=rels.get(id);
  if(!id||!r||r.type!==IMAGE||r.mode==='External')fail('unknown image relationship parent');
  const part=resolveTarget('word/_rels/document.xml.rels',r.target);
  const extension=part.match(/^word\/media\/[^/]+\.(png|bmp)$/i)?.[1].toLowerCase(),type=overrides.get('/'+part)||defaults.get(extension);
  if(!extension||type!=='image/'+extension)fail('only embedded PNG or bounded BMP images supported');
  const format=extension;required(part);const {crop,rotation,flipH,flipV}=assertDrawingGeometry(blip,body,checkedDrawings,format==='bmp'),previous=selected.get(part);if(previous&&(previous.rotation!==rotation||previous.flipH!==flipH||previous.flipV!==flipV||['l','t','r','b'].some(k=>previous.crop[k]!==crop[k])))fail('unsupported drawing geometry: different source mappings share media');selected.set(part,{format,crop,rotation,flipH,flipV,bodyOccurrences:(previous?.bodyOccurrences||0)+1});
 }
 if(!selected.size||selected.size>MAX_IMAGES)fail('main-body image count');
 let otherImages=0;
 for(const [name,bytes]of parts){if(!name.endsWith('.rels')||name==='word/_rels/document.xml.rels')continue;
  for(const r of relations(bytes).values()){if(r.type!==IMAGE)continue;if(r.mode==='External')fail('external image unsupported');const part=resolveTarget(name,r.target);if(selected.has(part))fail('image shared outside main body');otherImages++;}
 }
 if([...selected.values()].some(item=>item.format==='bmp'))for(const [name,bytes]of parts)if(name.endsWith('.rels'))for(const r of relations(bytes).values())if(r.mode!=='External'&&r.type!==IMAGE){const part=resolveTarget(name,r.target);if(selected.get(part)?.format==='bmp')fail('unsupported BMP: non-image relationship shares media');}
 const items=[],figures=[],handles=new Map();let pixels=0;
 // Validate every part/mapping before decoding any selected bitmap.
 const admitted=[];
 for(const [part,{format,bodyOccurrences,crop,rotation,flipH,flipV}]of selected){const bytes=required(part),info=format==='bmp'?bmpInfo(bytes):pngInfo(bytes),view=cropView(crop,info),cropped=view.x!==0||view.y!==0||view.width!==info.width||view.height!==info.height;pixels+=info.width*info.height;if(pixels>24_000_000)fail('aggregate image pixel limit');if(format==='png'&&(cropped||rotation||flipH||flipV))assertCropPng(bytes);const exportPart=format==='bmp'?`word/media/mtqc-image${admitted.length+1}.png`:part;if(format==='bmp'&&([...parts.keys()].some(n=>n.replace(/\/$/,'').toLowerCase()===exportPart.toLowerCase())||[...overrides.keys()].some(n=>n.toLowerCase()==='/'+exportPart.toLowerCase())))fail('unsupported BMP: PNG retarget collision');admitted.push({part,format,exportPart,bytes,bodyOccurrences,...info,view,cropped,rotation,flipH,flipV,displayWidth:rotation%180?view.height:view.width,displayHeight:rotation%180?view.width:view.height});}
 for(const admittedItem of admitted){const sourceBytes=admittedItem.bytes;if(admittedItem.format==='bmp')admittedItem.bytes=await bmpPng(sourceBytes,admittedItem);const {bytes,view,cropped,rotation,flipH,flipV,displayWidth,displayHeight}=admittedItem,decoded=await decodePng(bytes,admittedItem);try{if(cropped||rotation||flipH||flipV){const canvas=document.createElement('canvas');canvas.width=admittedItem.width;canvas.height=admittedItem.height;const context=canvas.getContext('2d');context.drawImage(decoded,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<data.length;i+=4)if(data[i]!==255)fail('unsupported drawing geometry: crop requires opaque source pixels');}}finally{decoded.close();}
  const handle=Object.freeze({}),item={handle,...admittedItem};items.push(item);handles.set(handle,item);
  const sourceSha256=await hex(sourceBytes);figures.push(Object.freeze({handle,part:item.part,sourceFormat:item.format,sourceSha256,bodyOccurrences:item.bodyOccurrences,width:displayWidth,height:displayHeight,mediaWidth:item.width,mediaHeight:item.height,sourceRect:view,rotation,flipH,flipV,get pngBytesCopy(){return bytes.slice();}}));
 }
 const session=Object.freeze({figures:Object.freeze(figures),sourceSha256:await hex(snapshot),unassessedOtherImages:otherImages});
 sessions.set(session,{snapshot,zip,parts,items,handles});return session;
}
// Exact orthogonal canvas transforms use integer pixel edges even for odd sizes.
function quarterTurn(source,rotation,doc=source.ownerDocument){
 if(!rotation)return source;const canvas=doc.createElement('canvas');canvas.width=rotation%180?source.height:source.width;canvas.height=rotation%180?source.width:source.height;const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
 if(rotation===90)context.setTransform(0,1,-1,0,source.height,0);else if(rotation===180)context.setTransform(-1,0,0,-1,source.width,source.height);else if(rotation===270)context.setTransform(0,-1,1,0,0,source.width);else fail('unknown private rotation');
 context.drawImage(source,0,0);context.resetTransform();return canvas;
}
// Reflection is an involution; dimensions and integer pixel edges stay exact.
function mirrorCanvas(source,flipH,flipV,doc=source.ownerDocument){
 if(!flipH&&!flipV)return source;const canvas=doc.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.setTransform(flipH?-1:1,0,0,flipV?-1:1,flipH?source.width:0,flipV?source.height:0);context.drawImage(source,0,0);context.resetTransform();return canvas;
}
export async function decodeDocxFigures(session,doc=document){
 const state=sessions.get(session);if(!state)fail('unknown source session');const records=[];
 for(const item of state.items){const bitmap=await decodePng(item.bytes,item);try{const canvas=doc.createElement('canvas');canvas.width=item.view.width;canvas.height=item.view.height;canvas.getContext('2d').drawImage(bitmap,item.view.x,item.view.y,item.view.width,item.view.height,0,0,item.view.width,item.view.height);const visible=quarterTurn(mirrorCanvas(canvas,item.flipH,item.flipV,doc),item.rotation,doc);records.push({canvas:visible,width:item.displayWidth,height:item.displayHeight,docxHandle:item.handle,label:`Image ${records.length+1} · ${item.bodyOccurrences} body reference(s)`});}finally{bitmap.close();}}
 return records;
}
export async function exportDocxFigures(session,changes){
 const state=sessions.get(session);if(!state)fail('unknown source session');
 if(!Array.isArray(changes)||!changes.length||changes.length>state.items.length)fail('missing or duplicate figure edits');
 const edits=new Map();
 // Capture every mutable caller byte array before the first asynchronous step.
 for(const change of changes){const item=state.handles.get(change?.handle);if(!item||edits.has(item.part)||!(change.pngBytes instanceof Uint8Array))fail('unknown, borrowed or duplicate figure edit');if(item.cropped)fail('cropped handle requires visible canvas');if(item.rotation)fail('rotated handle requires visible canvas');if(item.flipH||item.flipV)fail('mirrored handle requires visible canvas');const bytes=change.pngBytes.slice(),info=pngInfo(bytes);if(info.width!==item.width||info.height!==item.height)fail('changed image dimensions');edits.set(item.part,{bytes,info});}
 return writeEdits(state,edits);
}
async function writeEdits(state,edits){
 const parts=new Map(state.parts),metadata=new Map();
 for(const {bytes,info}of edits.values()){const bitmap=await decodePng(bytes,info);bitmap.close();}
 const retargeted=state.items.filter(item=>item.format==='bmp'&&edits.has(item.part));
 if(retargeted.length){
  const relDoc=xml(parts.get('word/_rels/document.xml.rels'),'Relationships'),typeDoc=xml(parts.get('[Content_Types].xml'),'Types');
  for(const item of retargeted){
   for(const rel of relDoc.documentElement.children)if(rel.getAttribute('Type')===IMAGE&&rel.getAttribute('TargetMode')!=='External'&&resolveTarget('word/_rels/document.xml.rels',rel.getAttribute('Target'))===item.part)rel.setAttribute('Target',item.exportPart.slice(5));
   for(const node of [...typeDoc.documentElement.children])if(node.localName==='Override'&&node.getAttribute('PartName')==='/'+item.part)node.remove();
   const node=typeDoc.createElementNS(CT,'Override');node.setAttribute('PartName','/'+item.exportPart);node.setAttribute('ContentType','image/png');typeDoc.documentElement.append(node);
   parts.delete(item.part);parts.set(item.exportPart,edits.get(item.part).bytes);metadata.set(item.exportPart,item.part);
  }
  const encode=doc=>new TextEncoder().encode(new XMLSerializer().serializeToString(doc));const relBytes=encode(relDoc),typeBytes=encode(typeDoc);if(relBytes.length>MAX_XML||typeBytes.length>MAX_XML)fail('retarget XML limit');parts.set('word/_rels/document.xml.rels',relBytes);parts.set('[Content_Types].xml',typeBytes);
 }
 for(const [part,edit]of edits)if(!retargeted.some(item=>item.part===part))parts.set(part,edit.bytes);
 let total=0;for(const bytes of parts.values())total+=bytes.length;if(total>MAX_TOTAL)fail('derived package size');
 const out=new Zip();out.comment=state.zip.comment;
 for(const [name,bytes]of parts){const e=state.zip.files[metadata.get(name)||name];out.file(name,bytes.slice(),{binary:true,dir:e.dir,date:e.date,comment:e.comment,unixPermissions:e.unixPermissions,dosPermissions:e.dosPermissions,createFolders:false});}
 const bytes=await out.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'});
 if(bytes.length>20*1024*1024)fail('derived archive size');return{bytes,changedImages:edits.size,sourceImages:state.items.length,convertedImages:retargeted.length};
}
export async function exportDocxCanvases(session,images){
 const state=sessions.get(session);if(!state||!Array.isArray(images)||!images.length||images.length>state.items.length)fail('unknown canvas export parent');
 const frozen=[];const seen=new Set();
 for(const image of images){const item=state.handles.get(image?.handle),canvas=image?.canvas;if(!item||seen.has(image.handle)||!canvas||canvas.width!==item.displayWidth||canvas.height!==item.displayHeight)fail('canvas source identity or dimensions');seen.add(image.handle);const copy=canvas.ownerDocument.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);frozen.push({item,canvas:copy});}
 const edits=new Map();
 for(const {item,canvas}of frozen){const unrotated=mirrorCanvas(quarterTurn(canvas,(360-item.rotation)%360),item.flipH,item.flipV);let full=unrotated;if(item.cropped){const bitmap=await decodePng(item.bytes,item);try{full=canvas.ownerDocument.createElement('canvas');full.width=item.width;full.height=item.height;const context=full.getContext('2d');context.drawImage(bitmap,0,0);context.putImageData(unrotated.getContext('2d').getImageData(0,0,unrotated.width,unrotated.height),item.view.x,item.view.y);}finally{bitmap.close();}}
  const blob=await new Promise(r=>full.toBlob(r,'image/png'));if(!blob)fail('PNG encoding');const bytes=new Uint8Array(await blob.arrayBuffer()),info=pngInfo(bytes);if(info.width!==item.width||info.height!==item.height)fail('merged media dimensions');edits.set(item.part,{bytes,info});
 }
 return writeEdits(state,edits);
}
