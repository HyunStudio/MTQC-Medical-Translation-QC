// All raster paint operators exported by the pinned PDF.js6.3.289. An image
// concern needs explicit visual assessment even for solid-color/image masks.
const imageNames = ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject',
  'paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup',
  'paintInlineImageXObjectGroup','paintSolidColorImageMask'];
const decodeReceipts = new WeakMap();

// Process-local identity only; serialized/copied receipts do not carry this
// binding. This proves neither original-source authenticity nor visible content.
export function isRasterDecodeReceipt(receipt, ops, operatorList) {
  const bound=receipt&&typeof receipt==='object'?decodeReceipts.get(receipt):null;
  return Boolean(bound&&bound.ops===ops&&bound.operatorList===operatorList);
}

// PDF.js otherwise tolerates failed image decoding and can return a partial
// operator list. Source review requires local decoders and explicit failure.
export function pdfDocumentOptions(data, assetBase = '/vendor/pdfjs/') {
  const base = /[\\/]$/.test(assetBase) ? assetBase : `${assetBase}/`;
  return { data, wasmUrl: `${base}wasm/`, standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`, cMapPacked: true, stopAtErrors: true, isEvalSupported: false };
}

export async function assertPageRasterDecoded(page, ops, operatorList, timeoutMs = 10000) {
  // In pinned PDF.js, asynchronous image failures resolve the image object to
  // null even with stopAtErrors. Rendering alone consequently can look complete.
  const ids = new Set();
  const fontIds = new Set();
  let fontReferencesValid=true,hasTextPaint=false;
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op=operatorList.fnArray[index],args=operatorList.argsArray[index];
    if([ops.showText,ops.showSpacedText,ops.nextLineShowText,ops.nextLineSetSpacingShowText].some(n=>Number.isInteger(n)&&n===op))hasTextPaint=true;
    if(Number.isInteger(ops.setFont)&&op===ops.setFont) {
      if(typeof args?.[0]==='string')fontIds.add(args[0]);else fontReferencesValid=false;
    }
    if(Number.isInteger(ops.setGState)&&op===ops.setGState&&Array.isArray(args?.[0]))for(const entry of args[0]) {
      if(entry?.[0]!=='Font')continue;
      if(Array.isArray(entry[1])&&typeof entry[1][0]==='string')fontIds.add(entry[1][0]);else fontReferencesValid=false;
    }
    if (operatorList.fnArray[index] === ops.dependency) {
      // Font Type3 charprocs and image masks may paint from nested lists. Their
      // image dependencies are propagated by pinned PDF.js to the page list.
      for (const id of operatorList.argsArray[index] || [])
        if (typeof id === 'string' && /(?:^|_)(?:img|mask)_/.test(id)) ids.add(id);
    }
    if (![ops.paintImageXObject, ops.paintImageXObjectRepeat].includes(operatorList.fnArray[index])) continue;
    const id = operatorList.argsArray[index]?.[0];
    if (typeof id !== 'string') throw new Error('Source image reference could not be decoded');
    ids.add(id);
  }
  const images = await Promise.all([...ids].map(id => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Source image decoding timed out')), timeoutMs);
    try {
      const objects = id.startsWith('g_') ? page.commonObjs : page.objs;
      objects.get(id, data => {
        clearTimeout(timer);
        if (!data || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) ||
            !(data.width > 0) || !(data.height > 0) || (!data.bitmap && !data.data?.length))
          reject(new Error('Source image failed to decode; partial structure rejected'));
        else resolve(Object.freeze({id,width:data.width,height:data.height}));
      });
    } catch (error) { clearTimeout(timer); reject(error); }
  })));
  // Rendering has resolved referenced font resources. Do not wait for missing
  // metadata or call it an image-decode failure: keep its raster coverage held.
  const fonts=[...fontIds].sort().map(id=>{
    let kind='unknown';
    try {if(page.commonObjs?.has?.(id)) {const font=page.commonObjs.get(id);
      if(typeof font?.isType3Font==='boolean')kind=font.isType3Font?'type3':'standard';}}
    catch { /* Unknown resource stays held; do not discard readable PDF text. */ }
    return Object.freeze({id,kind});
  });
  const fontInventoryComplete=fontReferencesValid&&(!hasTextPaint||fonts.length>0)&&fonts.every(f=>f.kind!=='unknown');
  const receipt=Object.freeze({version:'pdfjs-raster-decode-v1',images:Object.freeze(images.sort((a,b)=>a.id.localeCompare(b.id))),
    fonts:Object.freeze(fonts),fontInventoryComplete});
  decodeReceipts.set(receipt,{ops,operatorList});
  return receipt;
}

export function pageHasRasterImages(ops, fnArray, argsArray = [], receipt) {
  if (!ops || !Array.isArray(fnArray) || imageNames.some(name => !Number.isInteger(ops[name])))
    throw new TypeError('Known PDF raster operator inventory required');
  const imageOps = new Set(imageNames.map(name => ops[name]));
  // Patterns may contain inline raster with no propagated image dependency.
  // Unknown/Type3 fonts similarly require visual inventory; this conservative
  // concern does not assert that every Type3 font/pattern actually has images.
  const nestedPattern=fnArray.some(op=>op===ops.setFillColorN||op===ops.setStrokeColorN);
  let nestedFont=false;
  if(receipt!==undefined) {
    const bound=receipt&&typeof receipt==='object'?decodeReceipts.get(receipt):null;
    nestedFont=!bound||bound.ops!==ops||bound.operatorList.fnArray!==fnArray||bound.operatorList.argsArray!==argsArray||
      !receipt.fontInventoryComplete||receipt.fonts.some(f=>f.kind==='type3');
  }
  return nestedPattern||nestedFont||fnArray.some((op, index) => imageOps.has(op) || (op === ops.dependency &&
    argsArray[index]?.some(id => typeof id === 'string' && /(?:^|_)(?:img|mask)_/.test(id))));
}
