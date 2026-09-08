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

/**
 * Platform UI that covers the frame on 抖音 / 视频号 / Reels (fractions of a 1080×1920 canvas):
 * ~115px of status bar + tab row at the top, ~300px of caption/author/music at the
 * bottom, the like/comment/share rail ~120px wide on the right. Overlays stay inside.
 */
export const SAFE_ZONE = { top: 0.06, bottom: 0.16, right: 0.115, left: 0.05 };

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

  // Lowest centre line that keeps a ~4%-tall subtitle clear of the bottom UI band.
  const lowestSubtitleY = 1 - SAFE_ZONE.bottom - 0.03;
  const subtitleY = {
    lower_third: clamp(Math.max(faceBox.y + faceBox.h + 0.22, 0.70), 0.62, Math.min(0.80, lowestSubtitleY)),
    center_low: clamp(Math.max(faceBox.y + faceBox.h + 0.12, 0.60), 0.55, 0.70),
    bottom: lowestSubtitleY
  };

  function subtitle(position = 'lower_third') {
    const y = subtitleY[position] ?? subtitleY.lower_third;
    // 14 chars at 剪映 size 10-12 (+25% highlights) need ~75% of a 1080 canvas to stay on one line.
    return { ...toPx(0.5, y), yFraction: y, fixed_width: 0.82 };
  }

  // A punch line at 剪映 size 18-20 is ~6.5% of a 1920 canvas tall.
  const PUNCH_TEXT_HEIGHT = 0.065;
  const chin = faceBox.y + faceBox.h;
  // Band between the chin and the subtitle line where a big word can sit without touching either.
  const chestBand = { top: chin + 0.02, bottom: subtitleY.lower_third - 0.055 };

  /**
   * `above_head` needs the whole word to fit between the top UI band and the hairline;
   * in tight close-ups (face starting < ~15% from the top) it falls back to `top`
   * (safe band at the very top of the frame) so the word never sits on the subtitle
   * line. `chest` stays available when a beat explicitly asks for it. The placement
   * actually used is returned as `resolved` so lint can reason about B-roll collisions.
   */
  function punch(position = 'above_head') {
    const headroom = faceBox.y;
    let resolved = position || 'above_head';
    if (resolved === 'above_head' && headroom - SAFE_ZONE.top < PUNCH_TEXT_HEIGHT + 0.03) {
      resolved = 'top';
    }
    if (resolved === 'chest' && chestBand.bottom - chestBand.top < PUNCH_TEXT_HEIGHT) resolved = 'top';
    switch (resolved) {
      case 'beside_face': {
        const x = freeSide === 'right' ? clamp(faceBox.x + faceBox.w + 0.20, 0.55, 0.78) : clamp(faceBox.x - 0.20, 0.22, 0.45);
        return { ...toPx(x, faceCenterY), side: freeSide, fixed_width: 0.28, resolved };
      }
      case 'chest':
        return { ...toPx(0.5, (chestBand.top + chestBand.bottom) / 2), fixed_width: 0.6, resolved };
      case 'center':
        return { ...toPx(0.5, 0.48), fixed_width: 0.55, resolved };
      case 'top':
        return { ...toPx(0.5, SAFE_ZONE.top + 0.035), fixed_width: 0.55, resolved: 'top' };
      case 'above_head':
      default:
        return { ...toPx(0.5, clamp(headroom / 2, SAFE_ZONE.top + 0.03, 0.30)), fixed_width: 0.55, resolved: 'above_head' };
    }
  }

  const aspectRatio = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4 };

  /**
   * How much of the frame the face takes. Knowledge-channel editors aim for a face that
   * is ~35-45% of the frame height at most; above that ("tight") there is no room for
   * cards next to or above the head, and a full-frame picture with the speaker kept in
   * a small window is the layout that still shows both the object and the person.
   */
  const framing = faceBox.h > 0.30 || faceBox.y < 0.12 ? 'tight' : faceBox.h > 0.20 ? 'medium' : 'wide';

  /**
   * Diameter of the speaker window in `pip_face`, as a fraction of the canvas width.
   * Corner bubbles read at feed size between ~20% and ~30% of the frame width: below 20%
   * expressions vanish, above 30% the window starts competing with the picture. 300 px on
   * a 1080 canvas is the value talking-head recut pipelines have converged on.
   */
  const PIP_DIAMETER = 0.30;

  /**
   * A second copy of the talking-head clip, masked to a circle around the face, scaled
   * down and parked in the top-left corner inside the safe zone. VectCut masks live in
   * material space (centre-origin, +y down, size relative to material height) and move
   * with the clip, so the window is positioned by placing the *mask centre* where the
   * circle should land on the canvas.
   */
  function facePip() {
    const diameterPx = PIP_DIAMETER * size.width;
    const cx = SAFE_ZONE.left + PIP_DIAMETER / 2 + 0.02;
    const cy = SAFE_ZONE.top + (diameterPx / size.height) / 2 + 0.02;
    const maskSize = clamp(faceBox.h * 1.6, 0.22, 0.9);
    const scale = diameterPx / (maskSize * size.height);
    const maskCenterY = faceCenterY + 0.01;
    const transformX = (cx - 0.5) * size.width - (faceCenterX - 0.5) * size.width * scale;
    const transformY = (0.5 - cy) * size.height - (0.5 - maskCenterY) * size.height * scale;
    return {
      diameter: PIP_DIAMETER,
      center: { x: cx, y: cy },
      scale: Math.round(scale * 1000) / 1000,
      mask_type: '圆形',
      mask_center_x: Math.round((faceCenterX - 0.5) * 1000) / 1000,
      mask_center_y: Math.round((maskCenterY - 0.5) * 1000) / 1000,
      mask_size: Math.round(maskSize * 1000) / 1000,
      transform_x_px: Math.round(transformX * PX_UNIT),
      transform_y_px: Math.round(transformY * PX_UNIT)
    };
  }

  function broll(layoutName = 'card_top') {
    let spec;
    switch (layoutName) {
      case 'fullscreen':
        spec = { x: 0.5, y: 0.5, width: 1, aspect: '9:16', coversPerson: true };
        break;
      case 'pip_face':
        // Full-frame picture, speaker kept alive in a round window: the "avatar PiP" that
        // creator-grade shorts use instead of a postage-stamp card when the face fills the frame.
        spec = { x: 0.5, y: 0.5, width: 1, aspect: '9:16', coversPerson: true, pip: facePip() };
        break;
      case 'pip_side': {
        // Room between the face and the platform UI rail on the free side (the right-hand
        // like/comment column is much wider than the left margin).
        const edgeMargin = freeSide === 'right' ? SAFE_ZONE.right : SAFE_ZONE.left;
        const room = (freeSide === 'right' ? 1 - (faceBox.x + faceBox.w) : faceBox.x) - edgeMargin - 0.02;
        // Below ~20% of the width (216px) a reference picture is a thumbnail nobody can read.
        if (room < 0.2) return broll('lower_card');
        const width = Math.min(0.42, room);
        const x = freeSide === 'right' ? 1 - edgeMargin - width / 2 : edgeMargin + width / 2;
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
        // Fit a 16:9 card between the top UI band and the hairline; if that leaves a postage stamp, go below.
        const top = SAFE_ZONE.top;
        const available = faceBox.y - top - 0.015;
        const maxWidth = 0.82;
        const heightFraction = Math.min(available, (maxWidth * size.width * 9 / 16) / size.height);
        const width = (heightFraction * size.height * 16 / 9) / size.width;
        if (width < 0.34) return broll('lower_card');
        spec = { x: 0.5, y: top + heightFraction / 2, width, aspect: '16:9' };
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
    framing,
    subtitle,
    punch,
    broll,
    zoomAnchor,
    overlapsFace,
    toPx
  };
}
