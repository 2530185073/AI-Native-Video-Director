import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayout, SAFE_ZONE } from '../src/layout/layout.js';
import { computeImageScale, SCALE_UNIT } from '../src/vectcut/scale.js';

test('layout converts semantic placements into centre-origin pixels', () => {
  const layout = createLayout({ canvas: { width: 1080, height: 1920 }, person: { x: 0.2, y: 0.2, w: 0.6, h: 0.8 } });
  const subtitle = layout.subtitle('lower_third');
  assert.equal(subtitle.transform_x_px, 0);
  assert.ok(subtitle.transform_y_px < 0, 'subtitles sit below centre');
  assert.ok(subtitle.yFraction > layout.face.y + layout.face.h, 'subtitles are below the face');

  const punch = layout.punch('above_head');
  assert.ok(punch.transform_y_px > 0, 'punch text sits above centre');
  // VectCut px units: (width, height) is the top-right corner, so a fraction f above centre is f×2×height.
  assert.ok(!layout.overlapsFace(0.5 - punch.transform_y_px / (2 * 1920), 0.06));
  assert.equal(subtitle.transform_y_px, Math.round((0.5 - subtitle.yFraction) * 1920 * 2));

  const beside = layout.punch('beside_face');
  assert.equal(beside.side, 'right');
  assert.ok(beside.transform_x_px > 0);

  const card = layout.broll('card_top');
  assert.equal(card.aspect, '16:9');
  assert.ok(card.widthPx > 500 && card.transform_y_px > 0);
  const full = layout.broll('fullscreen');
  assert.deepEqual([full.widthPx, full.heightPx], [1080, 1920]);
});

test('layout accepts pixel boxes and moves the punch to the top when there is no head-room', () => {
  const layout = createLayout({ canvas: { width: 1080, height: 1920 }, person: { x: 100, y: 40, w: 880, h: 1880 }, face: { x: 340, y: 60, w: 400, h: 420 } });
  assert.ok(layout.face.y < 0.1);
  const punch = layout.punch('above_head');
  assert.equal(punch.resolved, 'top');
  const y = 0.5 - punch.transform_y_px / (2 * 1920);
  // Extreme close-ups put the hairline inside the UI band; top still parks in the safe band,
  // which is what keeps the word off the subtitle line even when it overlaps the forehead.
  assert.ok(Math.abs(y - (SAFE_ZONE.top + 0.035)) < 0.002, `top punch (${y}) sits in the top safe band`);
  assert.ok(y + 0.04 < layout.subtitle('lower_third').yFraction, 'top punch stays clear of the subtitle line');

  // Explicit chest with no room between chin and subtitles also lifts to top.
  const cramped = createLayout({ person: { x: 0, y: 0, w: 1, h: 1 }, face: { x: 0.3, y: 0.05, w: 0.4, h: 0.66 } });
  assert.equal(cramped.punch('chest').resolved, 'top');
});

test('tight close-up framing: overlays adapt to the measured free space', () => {
  // Real clip: head fills 28%-72% of the width and starts 14.5% from the top.
  const layout = createLayout({ person: { x: 0.05, y: 0.13, w: 0.9, h: 0.87 }, face: { x: 0.28, y: 0.145, w: 0.44, h: 0.385 } });

  // 14.5% of headroom minus the 6% UI band cannot hold a 6.5%-tall word, so the big word goes to the top.
  const punch = layout.punch('above_head');
  assert.equal(punch.resolved, 'top');
  const punchY = 0.5 - punch.transform_y_px / (2 * 1920);
  const subtitle = layout.subtitle('lower_third');
  assert.ok(subtitle.yFraction >= 0.7, 'subtitle goes below the chin');
  assert.ok(punchY + 0.035 < layout.face.y + 0.02, `top punch (${punchY}) stays above the hairline`);
  assert.ok(punchY + 0.035 < subtitle.yFraction, `punch (${punchY}) must clear the subtitle (${subtitle.yFraction})`);
  assert.equal(layout.punch('top').resolved, 'top');

  // 42%-wide side picture would cover the cheek: only ~24% is free on the right, so it moves under the chin.
  const pip = layout.broll('pip_side');
  assert.equal(pip.layout, 'lower_card');
  const chin = layout.face.y + layout.face.h;
  const pipTop = (0.5 - pip.transform_y_px / (2 * 1920)) - pip.heightPx / 1920 / 2;
  const pipBottom = pipTop + pip.heightPx / 1920;
  assert.ok(pipTop >= chin, `lower card top ${pipTop} must be below the chin ${chin}`);
  assert.ok(pipBottom <= subtitle.yFraction - 0.04, `lower card bottom ${pipBottom} must clear the subtitle at ${subtitle.yFraction}`);

  // Between the top UI band (~6%) and a hairline at 14.5% there is no room for a readable
  // 16:9 card, so a top card also moves under the chin instead of sitting on the forehead.
  const card = layout.broll('card_top');
  assert.equal(card.layout, 'lower_card');
  const cardTop = (0.5 - card.transform_y_px / (2 * 1920)) - card.heightPx / 1920 / 2;
  assert.ok(cardTop >= chin, `card top ${cardTop} must be below the chin ${chin}`);

  // Roomier framing keeps the wide card and the side picture.
  const roomy = createLayout({ person: { x: 0.2, y: 0.2, w: 0.6, h: 0.8 }, face: { x: 0.36, y: 0.2, w: 0.28, h: 0.2 } });
  assert.equal(roomy.broll('pip_side').layout, 'pip_side');
  const roomyCard = roomy.broll('card_top');
  assert.equal(roomyCard.layout, 'card_top');
  assert.ok(roomyCard.widthPx >= 0.34 * 1080);
  const roomyCardTop = (0.5 - roomyCard.transform_y_px / (2 * 1920)) - roomyCard.heightPx / 1920 / 2;
  assert.ok(roomyCardTop >= SAFE_ZONE.top - 0.001, `card top ${roomyCardTop} must clear the top UI band`);
});

test('pip_face keeps the speaker in a round window over a full-frame picture', () => {
  const tight = createLayout({ person: { x: 0.05, y: 0.13, w: 0.9, h: 0.87 }, face: { x: 0.28, y: 0.145, w: 0.44, h: 0.385 } });
  assert.equal(tight.framing, 'tight');
  const placement = tight.broll('pip_face');
  assert.equal(placement.layout, 'pip_face');
  assert.ok(placement.coversPerson);
  assert.equal(placement.widthPx, 1080, 'the picture itself is full frame');
  const pip = placement.pip;
  assert.equal(pip.mask_type, '圆形');
  // Mask is centred on the face in material space (centre origin, +y down).
  assert.ok(Math.abs(pip.mask_center_x - (0.28 + 0.22 - 0.5)) < 0.002);
  assert.ok(Math.abs(pip.mask_center_y - (0.145 + 0.1925 + 0.01 - 0.5)) < 0.002);
  assert.ok(pip.mask_size > 0.385 && pip.mask_size <= 0.9, 'circle is a little larger than the face');
  // Scaled so the circle lands as a 34%-of-width window inside the top-left safe zone.
  const diameterPx = pip.mask_size * 1920 * pip.scale;
  assert.ok(Math.abs(diameterPx - 0.30 * 1080) < 12, `window diameter ${diameterPx}`);
  assert.ok(pip.diameter >= 0.2 && pip.diameter <= 0.3, 'corner bubble stays in the 20-30% width band where a face still reads');
  assert.ok(pip.center.x - pip.diameter / 2 >= SAFE_ZONE.left - 0.001, 'window clears the left margin');
  assert.ok(pip.center.y - (diameterPx / 1920) / 2 >= SAFE_ZONE.top - 0.001, 'window clears the top UI band');
  // Placing the clip: canvas position of the (scaled) mask centre must equal the window centre.
  const faceCx = 0.28 + 0.22;
  const faceCy = 0.145 + 0.1925 + 0.01;
  const landedX = 0.5 + pip.transform_x_px / (2 * 1080) + (faceCx - 0.5) * pip.scale;
  const landedY = 0.5 - pip.transform_y_px / (2 * 1920) + (faceCy - 0.5) * pip.scale;
  assert.ok(Math.abs(landedX - pip.center.x) < 0.003, `window x ${landedX} vs ${pip.center.x}`);
  assert.ok(Math.abs(landedY - pip.center.y) < 0.003, `window y ${landedY} vs ${pip.center.y}`);

  assert.equal(createLayout({}).framing, 'medium');
  assert.equal(createLayout({ face: { x: 0.4, y: 0.25, w: 0.2, h: 0.14 } }).framing, 'wide');
});

test('overlays respect the platform UI safe zones', () => {
  const layout = createLayout({});
  const bottom = layout.subtitle('bottom');
  assert.ok(bottom.yFraction + 0.03 <= 1 - SAFE_ZONE.bottom, `subtitle at ${bottom.yFraction} would sit under the caption/author UI`);
  assert.ok(layout.subtitle('lower_third').yFraction <= bottom.yFraction);

  const top = layout.punch('top');
  assert.ok(0.5 - top.transform_y_px / (2 * 1920) - 0.03 >= SAFE_ZONE.top - 0.001, 'top punch clears the tab row');

  // Presenter framed left → picture-in-picture on the right must clear the like/comment rail.
  const leftFramed = createLayout({ person: { x: 0.02, y: 0.18, w: 0.5, h: 0.82 }, face: { x: 0.12, y: 0.2, w: 0.28, h: 0.2 } });
  const pip = leftFramed.broll('pip_side');
  assert.equal(pip.layout, 'pip_side');
  const pipRight = 0.5 + pip.transform_x_px / (2 * 1080) + pip.widthPx / 1080 / 2;
  assert.ok(pipRight <= 1 - SAFE_ZONE.right + 0.001, `pip right edge ${pipRight} is under the interaction rail`);
});

test('zoom anchor keeps the face in place while scaling', () => {
  const layout = createLayout({ face: { x: 0.3, y: 0.1, w: 0.4, h: 0.2 } });
  const anchor = layout.zoomAnchor(1.2);
  // Face centre is above the canvas centre, so scaling pushes it up; the anchor compensates downward.
  assert.ok(anchor.position_y_px < 0);
  assert.equal(anchor.position_x_px, 0);
});

test('image scale is relative to the fitted size on the canvas, in VectCut half-canvas units', () => {
  const canvas = { width: 1080, height: 1920 };
  assert.equal(SCALE_UNIT, 2);
  // 16:9 image fitted inside a 9:16 canvas has width 1080. Target 864px wide => 0.8 × unit.
  assert.equal(computeImageScale({ image: { width: 1376, height: 768 }, canvas, target: { widthPx: 864, heightPx: 486 }, fit: 'contain' }), 1.6);
  assert.equal(computeImageScale({ image: { width: 1376, height: 768 }, canvas, target: { widthPx: 864, heightPx: 486 }, fit: 'contain', unit: 1 }), 0.8);
  // 768x1376 is slightly narrower than 9:16; fitted height is 1920, width 1071.6 => cover needs 1080/1071.6.
  assert.equal(computeImageScale({ image: { width: 768, height: 1376 }, canvas, target: { widthPx: 1080, heightPx: 1920 }, fit: 'cover' }), 2.016);
  assert.equal(computeImageScale({ image: null, canvas, target: { widthPx: 1, heightPx: 1 } }), SCALE_UNIT);
  // Regression from the 翡翠 renders: a 529px lower_card from a 1376x768 image came out 265px wide at 0.49.
  assert.equal(computeImageScale({ image: { width: 1376, height: 768 }, canvas, target: { widthPx: 529, heightPx: 298 }, fit: 'contain' }), 0.98);
});
