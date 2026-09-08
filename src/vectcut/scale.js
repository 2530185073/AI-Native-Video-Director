/**
 * 剪映/VectCut display a material at scale 1.0 fitted *inside* the canvas
 * (letterboxed "contain"). Scale factors are relative to that fitted size, so a
 * B-roll image has to be scaled from its fitted size to the layout's target box.
 *
 * Measured on cloud renders (two clips, lower_card and card_top): an image sent with
 * scale s comes out at s × fitted / 2 — the same "1.0 = half a canvas" convention as
 * VectCut's px coordinates (see `PX_UNIT` in the layout engine). `SCALE_UNIT`
 * compensates so `target` is the size that actually appears on screen.
 */
export const SCALE_UNIT = 2;

export function fittedSize({ width, height }, canvas) {
  const ratio = Math.min(canvas.width / width, canvas.height / height);
  return { width: width * ratio, height: height * ratio };
}

export function computeImageScale({ image, canvas, target, fit = 'contain', unit = SCALE_UNIT }) {
  if (!image?.width || !image?.height) return unit;
  const fitted = fittedSize(image, canvas);
  const ratios = [target.widthPx / fitted.width, target.heightPx / fitted.height];
  const scale = (fit === 'cover' ? Math.max(...ratios) : Math.min(...ratios)) * unit;
  return Math.round(scale * 1000) / 1000;
}
