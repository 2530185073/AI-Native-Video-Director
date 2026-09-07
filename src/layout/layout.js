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

  // VectCut's "px" coordinate system spans -width..+width / -height..+height with the
  // centre at (0,0) — i.e. (width, height) is the top-right corner (it stores px/height,
  // and 剪映 treats 1.0 as half a canvas). A displacement of f×height therefore needs 2×f×height.
  const PX_UNIT = 2;
  const toPx = (xFraction, yFraction) => ({
    transform_x_px: Math.round((xFraction - 0.5) * size.width * PX_UNIT),
    transform_y_px: Math.round((0.5 - yFraction) * size.height * PX_UNIT)
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
        // Room between the face and the frame edge on the free side, minus a safe margin.
        const room = (freeSide === 'right' ? 1 - (faceBox.x + faceBox.w) : faceBox.x) - 0.04;
        if (room < 0.26) return broll('lower_card');
        const width = Math.min(0.42, room - 0.02);
        const x = freeSide === 'right' ? 1 - 0.03 - width / 2 : 0.03 + width / 2;
        spec = { x, y: faceCenterY, width, aspect: '1:1', side: freeSide };
        break;
      }
      case 'lower_card': {
        // Fit a 16:9 card between the chin and the top of the subtitle line.
        const bandTop = faceBox.y + faceBox.h + 0.02;
        const bandBottom = subtitleY.lower_third - 0.045;
        const maxHeight = (0.82 * size.width * 9 / 16) / size.height;
        const heightFraction = clamp(bandBottom - bandTop, 0.12, maxHeight);
        const width = (heightFraction * size.height * 16 / 9) / size.width;
        spec = { x: 0.5, y: clamp(bandTop + heightFraction / 2, 0.45, 0.66), width, aspect: '16:9' };
        break;
      }
      case 'card_top':
      default: {
        // Fit a 16:9 card into the headroom above the hair; if that leaves a postage stamp, go below.
        const available = faceBox.y - 0.03;
        const maxWidth = 0.82;
        const heightFraction = Math.min(available, (maxWidth * size.width * 9 / 16) / size.height);
        const width = (heightFraction * size.height * 16 / 9) / size.width;
        if (width < 0.34) return broll('lower_card');
        spec = { x: 0.5, y: 0.02 + heightFraction / 2, width, aspect: '16:9' };
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
    const fx = (faceCenterX - 0.5) * size.width * PX_UNIT;
    const fy = (0.5 - faceCenterY) * size.height * PX_UNIT;
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
