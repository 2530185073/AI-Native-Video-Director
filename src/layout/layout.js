/**
 * Layout engine: turns semantic placements ("above the head", "lower third")
 * into VectCut canvas-centre pixel offsets, using the known position of the
 * digital human in frame.
 *
 * Boxes are normalised top-left fractions `{ x, y, w, h }` of the canvas.
 * VectCut uses a centre-origin pixel system where +y is *up*.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Typical 9:16 digital-human framing: presenter centred, ~18% head-room above the hair.
export const DEFAULT_PERSON_BOX = { x: 0.18, y: 0.18, w: 0.64, h: 0.82 };
export const DEFAULT_FACE_BOX = { x: 0.34, y: 0.20, w: 0.32, h: 0.22 };

function normalizeBox(box, fallback) {
  if (!box) return { ...fallback };
  const x = Number(box.x ?? box.left ?? fallback.x);
  const y = Number(box.y ?? box.top ?? fallback.y);
  const w = Number(box.w ?? box.width ?? fallback.w);
  const h = Number(box.h ?? box.height ?? fallback.h);
  const result = { x, y, w, h };
  for (const key of Object.keys(result)) {
    if (!Number.isFinite(result[key])) return { ...fallback };
  }
  // Pixel boxes are accepted too: anything above 1.5 is treated as pixels.
  return result;
}

function toFraction(box, canvas) {
  const looksLikePixels = box.x > 1.5 || box.y > 1.5 || box.w > 1.5 || box.h > 1.5;
  if (!looksLikePixels) return box;
  return { x: box.x / canvas.width, y: box.y / canvas.height, w: box.w / canvas.width, h: box.h / canvas.height };
}

function faceFromPerson(person) {
  // A standing/seated presenter's head is roughly the top 27% of the body box.
  return { x: person.x + person.w * 0.25, y: person.y + person.h * 0.03, w: person.w * 0.5, h: person.h * 0.27 };
}

export function createLayout({ canvas = { width: 1080, height: 1920 }, person, face } = {}) {
  const size = { width: Number(canvas.width) || 1080, height: Number(canvas.height) || 1920 };
  const personBox = toFraction(normalizeBox(person, DEFAULT_PERSON_BOX), size);
  const faceBox = face ? toFraction(normalizeBox(face, DEFAULT_FACE_BOX), size) : faceFromPerson(personBox);
  const faceCenterX = faceBox.x + faceBox.w / 2;
  const faceCenterY = faceBox.y + faceBox.h / 2;
  const freeSide = faceCenterX <= 0.5 ? 'right' : 'left';

  const toPx = (xFraction, yFraction) => ({
    transform_x_px: Math.round((xFraction - 0.5) * size.width),
    transform_y_px: Math.round((0.5 - yFraction) * size.height)
  });

  const subtitleY = {
    lower_third: clamp(Math.max(faceBox.y + faceBox.h + 0.22, 0.70), 0.62, 0.80),
    center_low: clamp(Math.max(faceBox.y + faceBox.h + 0.12, 0.60), 0.55, 0.70),
    bottom: 0.86
  };

  function subtitle(position = 'lower_third') {
    const y = subtitleY[position] ?? subtitleY.lower_third;
    // 14 chars at 剪映 size 10-12 (+25% highlights) need ~75% of a 1080 canvas to stay on one line.
    return { ...toPx(0.5, y), yFraction: y, fixed_width: 0.82 };
  }

  function punch(position = 'above_head') {
    const headroom = faceBox.y;
    if (position === 'above_head' && headroom < 0.14) position = 'beside_face';
    switch (position) {
      case 'beside_face': {
        const x = freeSide === 'right' ? clamp(faceBox.x + faceBox.w + 0.20, 0.55, 0.78) : clamp(faceBox.x - 0.20, 0.22, 0.45);
        return { ...toPx(x, faceCenterY), side: freeSide, fixed_width: 0.28 };
      }
      case 'center':
        return { ...toPx(0.5, 0.48), fixed_width: 0.55 };
      case 'top':
        return { ...toPx(0.5, 0.10), fixed_width: 0.55 };
      case 'above_head':
      default:
        return { ...toPx(0.5, clamp(headroom / 2, 0.08, 0.30)), fixed_width: 0.55 };
    }
  }

  const aspectRatio = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4 };

  function broll(layoutName = 'card_top') {
    let spec;
    switch (layoutName) {
      case 'fullscreen':
        spec = { x: 0.5, y: 0.5, width: 1, aspect: '9:16', coversPerson: true };
        break;
      case 'pip_side': {
        const x = freeSide === 'right' ? 0.74 : 0.26;
        spec = { x, y: faceCenterY, width: 0.42, aspect: '1:1', side: freeSide };
        break;
      }
      case 'lower_card':
        spec = { x: 0.5, y: clamp(subtitleY.lower_third - 0.17, 0.45, 0.62), width: 0.82, aspect: '16:9' };
        break;
      case 'card_top':
      default: {
        const headroom = faceBox.y;
        spec = { x: 0.5, y: clamp(headroom / 2, 0.10, 0.28), width: headroom < 0.18 ? 0.6 : 0.82, aspect: '16:9' };
      }
    }
    const widthPx = Math.round(spec.width * size.width);
    const heightPx = Math.round(widthPx / aspectRatio[spec.aspect]);
    return { ...spec, ...toPx(spec.x, spec.y), widthPx, heightPx, layout: layoutName };
  }

  /**
   * Offsets that keep the face where it is while the clip is scaled by `scale`
   * around the canvas centre.
   */
  function zoomAnchor(scale) {
    const fx = (faceCenterX - 0.5) * size.width;
    const fy = (0.5 - faceCenterY) * size.height;
    return {
      position_x_px: Math.round(fx * (1 - scale)) || 0,
      position_y_px: Math.round(fy * (1 - scale)) || 0
    };
  }

  function overlapsFace(yFraction, heightFraction = 0.06) {
    const top = yFraction - heightFraction / 2;
    const bottom = yFraction + heightFraction / 2;
    return bottom > faceBox.y && top < faceBox.y + faceBox.h;
  }

  return {
    canvas: size,
    person: personBox,
    face: faceBox,
    freeSide,
    subtitle,
    punch,
    broll,
    zoomAnchor,
    overlapsFace,
    toPx
  };
}
