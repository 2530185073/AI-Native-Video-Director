import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayout } from '../src/layout/layout.js';
import { computeImageScale } from '../src/vectcut/scale.js';

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

test('layout accepts pixel boxes and falls back to beside_face when there is no head-room', () => {
  const layout = createLayout({ canvas: { width: 1080, height: 1920 }, person: { x: 100, y: 40, w: 880, h: 1880 }, face: { x: 340, y: 60, w: 400, h: 420 } });
  assert.ok(layout.face.y < 0.1);
  const punch = layout.punch('above_head');
  assert.ok(punch.side, 'should have fallen back to a side placement');
});

test('tight close-up framing: overlays adapt to the measured free space', () => {
  // Real clip: head fills 28%-72% of the width and starts 14.5% from the top.
  const layout = createLayout({ person: { x: 0.05, y: 0.13, w: 0.9, h: 0.87 }, face: { x: 0.28, y: 0.145, w: 0.44, h: 0.385 } });

  const punch = layout.punch('above_head');
  const punchY = 0.5 - punch.transform_y_px / (2 * 1920);
  assert.ok(punchY + 0.03 < layout.face.y, `punch (${punchY}) must clear the hairline (${layout.face.y})`);

  const subtitle = layout.subtitle('lower_third');
  assert.ok(subtitle.yFraction >= 0.7, 'subtitle goes below the chin');

  // 42%-wide side picture would cover the cheek: only ~24% is free on the right, so it moves under the chin.
  const pip = layout.broll('pip_side');
  assert.equal(pip.layout, 'lower_card');
  const chin = layout.face.y + layout.face.h;
  const pipTop = (0.5 - pip.transform_y_px / (2 * 1920)) - pip.heightPx / 1920 / 2;
  const pipBottom = pipTop + pip.heightPx / 1920;
  assert.ok(pipTop >= chin, `lower card top ${pipTop} must be below the chin ${chin}`);
  assert.ok(pipBottom <= subtitle.yFraction - 0.04, `lower card bottom ${pipBottom} must clear the subtitle at ${subtitle.yFraction}`);

  // A top card has to fit into the 14.5% headroom, so it shrinks instead of sitting on the forehead.
  const card = layout.broll('card_top');
  assert.equal(card.layout, 'card_top');
  const cardBottom = (0.5 - card.transform_y_px / (2 * 1920)) + card.heightPx / 1920 / 2;
  assert.ok(cardBottom <= layout.face.y + 0.001, `card bottom ${cardBottom} overlaps face top ${layout.face.y}`);
  assert.ok(card.widthPx >= 0.34 * 1080);

  // Roomier framing keeps the wide card and the side picture.
  const roomy = createLayout({ person: { x: 0.2, y: 0.2, w: 0.6, h: 0.8 }, face: { x: 0.36, y: 0.2, w: 0.28, h: 0.2 } });
  assert.equal(roomy.broll('pip_side').layout, 'pip_side');
  assert.ok(roomy.broll('card_top').widthPx > 500);
});

test('zoom anchor keeps the face in place while scaling', () => {
  const layout = createLayout({ face: { x: 0.3, y: 0.1, w: 0.4, h: 0.2 } });
  const anchor = layout.zoomAnchor(1.2);
  // Face centre is above the canvas centre, so scaling pushes it up; the anchor compensates downward.
  assert.ok(anchor.position_y_px < 0);
  assert.equal(anchor.position_x_px, 0);
});

test('image scale is relative to the fitted size on the canvas', () => {
  const canvas = { width: 1080, height: 1920 };
  // 16:9 image fitted inside a 9:16 canvas has width 1080. Target 864px wide => 0.8.
  assert.equal(computeImageScale({ image: { width: 1376, height: 768 }, canvas, target: { widthPx: 864, heightPx: 486 }, fit: 'contain' }), 0.8);
  // 768x1376 is slightly narrower than 9:16; fitted height is 1920, width 1071.6 => cover needs 1080/1071.6.
  assert.equal(computeImageScale({ image: { width: 768, height: 1376 }, canvas, target: { widthPx: 1080, heightPx: 1920 }, fit: 'cover' }), 1.008);
  assert.equal(computeImageScale({ image: null, canvas, target: { widthPx: 1, heightPx: 1 } }), 1);
});
