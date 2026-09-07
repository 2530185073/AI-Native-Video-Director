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
  assert.ok(!layout.overlapsFace(0.5 - punch.transform_y_px / 1920, 0.06));

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
