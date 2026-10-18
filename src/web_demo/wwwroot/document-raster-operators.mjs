// All raster paint operators exported by the pinned PDF.js6.3.289. An image
// concern needs explicit visual assessment even for solid-color/image masks.
const imageNames = ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject',
  'paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup',
  'paintInlineImageXObjectGroup','paintSolidColorImageMask'];

export function pageHasRasterImages(ops, fnArray) {
  if (!ops || !Array.isArray(fnArray) || imageNames.some(name => !Number.isInteger(ops[name])))
    throw new TypeError('Known PDF raster operator inventory required');
  const imageOps = new Set(imageNames.map(name => ops[name]));
  return fnArray.some(op => imageOps.has(op));
}
