import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageMaskControlPdf} from './authored-pdf-controls.mjs';
import {authoredHostRequest} from './private-host-controls.mjs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web_demo_client/package.json',import.meta.url));
const {createCanvas}=require('@napi-rs/canvas');
import {createSelectedPageReviewDraft} from '../web_demo_evaluation/structure-selected-page-intake.mjs';
import {startPrivateReviewHost} from '../web_demo_evaluation/structure-private-review-host.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Authored PDF1.7 originals: each selected page has its own renderer PNG.
// Prior matching solid RGB fills remain conservatively unassessed at text.
function original({setup='',prefix='',suffix='',shape='1 g 20 20 10 10 re f',pixel='000000',tile='0 g',shade='0 0 0',textless=false}={}){
  const stream=(s,extra='')=>`<< ${extra} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const resources='/Resources << /Font << /F1 3 0 R >> /Pattern << /Tile 8 0 R >> /XObject << /Shape 9 0 R /Pixel 11 0 R >> /Shading << /Shade 12 0 R >> /ExtGState << /Transparent 10 0 R >> >>';
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 5 0 R >>`,stream('BT /F1 12 Tf 20 260 Td (OUTER) Tj ET'),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ${resources} /Contents 7 0 R >>`,stream(`${prefix} ${textless?'':`BT /F1 12 Tf ${setup} 20 100 Td (PAINT) Tj ET`} ${suffix}`),
    stream(`${tile} 0 0 10 10 re f`,'/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>'),
    stream(shape,'/Type /XObject /Subtype /Form /BBox [0 0 200 300] /Resources << /XObject << /Pixel 11 0 R >> >>'), '<< /Type /ExtGState /ca 0 >>',
    stream(`${pixel}>`,'/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode'),
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 200 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [${shade}] /C1 [${shade}] /N 1 >> /Extend [true true] >>`];
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return new Uint8Array(Buffer.from(pdf+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
}
async function request(options){
  const sourceBytes=original(options),selections=[];
  const pdfjs=await import('../web_demo_client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(sourceBytes),useSystemFonts:true,isEvalSupported:false,stopAtErrors:true});
  try{const pdf=await task.promise;
    for(const physicalPage of [1,2]){
      const page=await pdf.getPage(physicalPage),viewport=page.getViewport({scale:1}),canvas=pdf.canvasFactory.create(200,300);let png;
      try{await page.render({canvasContext:canvas.context,viewport}).promise;png=new Uint8Array(canvas.canvas.toBuffer('image/png'));}
      finally{pdf.canvasFactory.destroy(canvas);}
      selections.push({identity:{caseId:`authored-earlier-paint-${physicalPage}`,physicalPage,sourceSha256:hash(sourceBytes),pageImageSha256:hash(png)},canonicalImageBytes:png,
        frame:{viewBox:[0,0,200,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:200,height:300}});
    }
  }finally{await task.destroy();}
  return {sourceBytes,selections};
}
async function refusal(options,reason='EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED'){
  assert.deepEqual(await createSelectedPageReviewDraft(await request(options)),{status:'ABSTAIN',reason});
}
for(const [name,options] of [
 ['black raster before text',{prefix:'q 130 0 0 50 10 80 cm /Pixel Do Q'}],
 ['white raster before text',{prefix:'q 130 0 0 50 10 80 cm /Pixel Do Q',pixel:'ffffff'}],
 ['transparent raster before text',{prefix:'q /Transparent gs 130 0 0 50 10 80 cm /Pixel Do Q'}],
 ['disjoint raster before text',{prefix:'q 10 0 0 10 0 0 cm /Pixel Do Q'}],
 ['nested saves retain raster history',{prefix:'q q 130 0 0 50 10 80 cm /Pixel Do Q Q'}],
 ['textless Form retains raster history',{prefix:'q /Shape Do Q',shape:'q 130 0 0 50 10 80 cm /Pixel Do Q'}],
 ['black pattern before text',{prefix:'q /Pattern cs /Tile scn 10 80 130 50 re f Q'}],
 ['white pattern before text',{prefix:'q /Pattern cs /Tile scn 10 80 130 50 re f Q',tile:'1 g'}],
 ['pattern even-odd fill before text',{prefix:'q /Pattern cs /Tile scn 10 80 130 50 re f* Q'}],
 ['pattern fill and white stroke before text',{prefix:'q 1 G /Pattern cs /Tile scn 10 80 130 50 re B Q'}],
 ['pattern stroke before text',{prefix:'q 1 g /Pattern CS /Tile SCN 10 80 130 50 re S Q'}],
 ['black shading before text',{prefix:'q /Shade sh Q'}],
 ['white shading before text',{prefix:'q /Shade sh Q',shade:'1 1 1'}],
 ['nested shading history',{prefix:'q q /Shade sh Q Q'}],
])test(`${name} refuses the whole late-page selection`,async()=>{await refusal(options);});
for(const [name,options] of [
 ['no earlier paint',{}],
 ['declared image/shading resources without use',{}],
 ['pattern declaration without paint',{prefix:'q /Pattern cs /Tile scn Q'}],
 ['discarded pattern path',{prefix:'q /Pattern cs /Tile scn 10 80 130 50 re n Q'}],
 ['unmatched black solid fill and blue text',{prefix:'q 0 g 10 80 130 50 re f Q',setup:'0 0 1 rg'}],
])test(`${name} retains an explicitly unverified draft`,async()=>{
 const input=await request(options),result=await createSelectedPageReviewDraft(input);
 assert.equal(result.status,'DRAFT');assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
 assert.deepEqual(result.pages.map(p=>p.record.fragments.map(f=>f.text)),[['OUTER'],['PAINT']]);
 assert.ok(result.pages.every(p=>p.sourceRenderEquivalence==='unverified'&&p.canonicalFragmentCrosswalk==='unavailable'));
});
test('original image mask with caption holds without rewriting its bytes',async()=>{
 const sourceBytes=imageMaskControlPdf(),canonicalImageBytes=new Uint8Array(createCanvas(300,300).toBuffer('image/png'));
 assert.deepEqual(await createSelectedPageReviewDraft({sourceBytes,selections:[{identity:{caseId:'original-mask',physicalPage:1,sourceSha256:hash(sourceBytes),pageImageSha256:hash(canonicalImageBytes)},canonicalImageBytes,frame:{viewBox:[0,0,300,300],rotation:0,scale:1,transform:[1,0,0,-1,0,300],width:300,height:300}}]}),{status:'ABSTAIN',reason:'EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED'});
});
test('original private-host image-mask request holds as a whole',async()=>{
 assert.deepEqual(await createSelectedPageReviewDraft(authoredHostRequest('original-mask')),{status:'ABSTAIN',reason:'EARLIER_PAINT_NATIVE_VISIBILITY_UNASSESSED'});
});
test('path clipping keeps priority over earlier raster history',async()=>{
 await refusal({prefix:'q 130 0 0 50 10 80 cm /Pixel Do Q 0 0 200 300 re W n'},'PATH_CLIP_NATIVE_VISIBILITY_UNASSESSED');
});
test('late paint keeps priority over earlier raster history',async()=>{
 await refusal({prefix:'q 130 0 0 50 10 80 cm /Pixel Do Q',suffix:'1 g 0 0 200 300 re f'},'LATE_PAINT_NATIVE_VISIBILITY_UNASSESSED');
});
test('raster-only page retains an empty unverified visual inventory draft',async()=>{
 const input=await request({prefix:'q 130 0 0 50 10 80 cm /Pixel Do Q',textless:true});
 const result=await createSelectedPageReviewDraft(input);assert.equal(result.status,'DRAFT');
 assert.equal(hash(result.sourceBytes),hash(input.sourceBytes));
 assert.deepEqual(result.pages[1].record.fragments,[]);assert.equal(result.pages[1].record.hasImages,true);
 assert.deepEqual(result.document.pages[1].regions,[]);
 assert.ok(result.document.pages[1].issues.some(i=>i.code==='raster-content-unassessed'));
 assert.equal(result.document.pages[1].visualInventoryConfirmed,false);
});
test('original image-mask request cannot mount a private editor',async()=>{
 await assert.rejects(startPrivateReviewHost(authoredHostRequest('original-mask')),/Private intake refused/);
});
