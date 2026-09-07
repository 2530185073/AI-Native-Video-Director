/**
 * 剪映/VectCut display a material at scale 1.0 fitted *inside* the canvas
 * (letterboxed "contain"). Scale factors are relative to that fitted size, so a
 * B-roll image has to be scaled from its fitted size to the layout's target box.
 */
export function fittedSize({ width, height }, canvas) {
  const ratio = Math.min(canvas.width / width, canvas.height / height);
  return { width: width * ratio, height: height * ratio };
}

export function computeImageScale({ image, canvas, target, fit = 'contain' }) {
  if (!image?.width || !image?.height) return 1;
  const fitted = fittedSize(image, canvas);
  const ratios = [target.widthPx / fitted.width, target.heightPx / fitted.height];
  const scale = fit === 'cover' ? Math.max(...ratios) : Math.min(...ratios);
  return Math.round(scale * 1000) / 1000;
}
