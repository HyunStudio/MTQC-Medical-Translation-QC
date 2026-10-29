// Product limits: area alone does not ensure a usable browser canvas bitmap.
const MAX_RENDER_PIXELS = 12_000_000;
const MAX_RENDER_SIDE = 32_767;
const MAX_CROP_SIDE = 800;

const positive = value => Number.isFinite(value) && value > 0;

export function validRenderDimensions(width, height) {
  if (!positive(width) || !positive(height)) return false;
  const pixelsWide = Math.ceil(width);
  const pixelsHigh = Math.ceil(height);
  return pixelsWide <= MAX_RENDER_SIDE && pixelsHigh <= MAX_RENDER_SIDE &&
    pixelsWide * pixelsHigh <= MAX_RENDER_PIXELS;
}

export function fitSourceCrop(width, height) {
  if (!positive(width) || !positive(height)) return null;
  const scale = Math.min(2, MAX_CROP_SIDE / width, MAX_CROP_SIDE / height);
  return { width: Math.max(1, Math.min(MAX_CROP_SIDE, Math.ceil(width * scale))),
    height: Math.max(1, Math.min(MAX_CROP_SIDE, Math.ceil(height * scale))) };
}
