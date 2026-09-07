import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, summarizeOps, TRACKS } from '../src/vectcut/compiler.js';
import { executeOps, summarizeScript } from '../src/vectcut/executor.js';
import { fixture, samplePlan, mockVectCut, mockImageProvider } from './helpers/fixture.js';

const inputs = { videoUrl: 'https://cdn.test/first-cut.mp4', audioUrl: 'https://cdn.test/voice.mp3', duration: 21.8 };

test('compilePlan emits draft → video → keyframes → subtitles → beats → verification', () => {
  const { chunks, layout } = fixture();
  const plan = samplePlan(chunks);
  const ops = compilePlan({ plan, chunks, layout, inputs });
  const names = ops.map(op => op.op);
  assert.equal(names[0], 'create_draft');
  assert.equal(names[1], 'add_video');
  assert.equal(names.at(-1), 'query_script');
  assert.ok(names.indexOf('add_video_keyframe') < names.indexOf('add_batch_text'));
  assert.ok(names.includes('broll_image') && names.includes('add_effect'));
  assert.equal(summarizeOps(ops).includes('add_text x1'), true);

  const video = ops[1].params;
  assert.equal(video.track_name, TRACKS.video);
  assert.equal(video.end, 21.8);
  assert.equal(video.volume, undefined, 'clip audio kept unless replaceAudio');

  const subtitles = ops.find(op => op.op === 'add_batch_text');
  assert.equal(subtitles.params.texts.length, chunks.length);
  assert.equal(subtitles.params.starts.length, chunks.length);
  assert.equal(subtitles.fallback.length, chunks.length);
  const highlighted = subtitles.params.text_styles_list[1];
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].start, 0);
  assert.equal(highlighted[0].end, 2);
  assert.equal(highlighted[0].style.color, '#FFE14D');
  assert.equal(highlighted[0].style.size, 13);
  assert.ok(subtitles.params.transform_y_px < 0);
  assert.equal(subtitles.params.font, 'SourceHanSansCN_Bold');

  const punch = ops.find(op => op.op === 'add_text');
  assert.equal(punch.params.text, '一万块');
  assert.equal(punch.params.effect_effect_id, 'W0BpSlRRRldCZlhQTFpAaERcUw==');
  assert.equal(punch.params.loop_animation, '轻微跳动');
  assert.ok(punch.params.start >= chunks[1].start && punch.params.end >= chunks[1].end);
  assert.ok(punch.params.transform_y_px > 0);

  const zoom = ops.find(op => op.op === 'add_video_keyframe').params;
  assert.equal(zoom.track_name, TRACKS.video);
  assert.equal(zoom.property_types.filter(type => type === 'uniform_scale').length, 4);
  assert.deepEqual(zoom.values.slice(0, 4), ['1.0', '1.120', '1.120', '1.0']);
  assert.equal(zoom.times.length, zoom.values.length);

  const broll = ops.find(op => op.op === 'broll_image');
  assert.equal(broll.aspect, '9:16');
  assert.equal(broll.target.fit, 'cover');
  assert.equal(broll.params.relative_index, 200);
  assert.ok(broll.params.end - broll.params.start >= 1.2);

  const effect = ops.find(op => op.op === 'add_effect');
  assert.equal(effect.optional, true);
  assert.ok(effect.params.end - effect.params.start <= 0.5 + 1e-9);
});

test('compilePlan wires replacement narration and BGM when requested', () => {
  const { chunks, layout } = fixture();
  const ops = compilePlan({ plan: samplePlan(chunks), chunks, layout, inputs: { ...inputs, replaceAudio: true, bgmUrl: 'https://cdn.test/bgm.mp3' } });
  const video = ops.find(op => op.op === 'add_video').params;
  assert.equal(video.volume, -100);
  const audios = ops.filter(op => op.op === 'add_audio');
  assert.equal(audios.length, 2);
  assert.equal(audios[0].params.track_name, TRACKS.narration);
  assert.equal(audios[1].params.volume, -18);
  assert.equal(audios[1].optional, true);
});

test('executeOps runs ops, resolves B-roll through the image provider and verifies the draft', async () => {
  const { chunks, layout } = fixture();
  const ops = compilePlan({ plan: samplePlan(chunks), chunks, layout, inputs });
  const client = mockVectCut();
  const imageProvider = mockImageProvider();
  const result = await executeOps(ops, { client, imageProvider, canvas: layout.canvas });
  assert.equal(result.draftId, 'dfd_test');
  assert.equal(imageProvider.calls.length, 1);
  assert.ok(imageProvider.calls[0].prompt.includes('风格要求'));
  const image = client.calls.find(call => call.name === 'add_image');
  assert.equal(image.params.image_url, 'https://img.test/1.png');
  assert.equal(image.params.draft_id, 'dfd_test');
  assert.ok(image.params.scale_x >= 1);
  assert.equal(result.verification.tracks.length, 2);
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.warnings, []);
  assert.ok(client.calls.every(call => call.name === 'create_draft' || call.params.draft_id === 'dfd_test'));
});

test('executeOps falls back to per-line subtitles and tolerates optional failures', async () => {
  const { chunks, layout } = fixture();
  const ops = compilePlan({ plan: samplePlan(chunks), chunks, layout, inputs });
  const client = mockVectCut({ failBatchText: true, failEffect: true });
  const result = await executeOps(ops, { client, imageProvider: null, canvas: layout.canvas });
  const singles = client.calls.filter(call => call.name === 'add_text');
  assert.equal(singles.length, chunks.length + 1, 'every subtitle line plus the punch');
  assert.ok(result.warnings.some(warning => warning.includes('falling back')));
  assert.ok(result.warnings.some(warning => warning.includes('add_effect skipped')));
  assert.ok(result.warnings.some(warning => warning.includes('no image provider')));
});

test('executeOps dry-run performs no calls and summarizeScript handles empty input', async () => {
  const result = await executeOps([{ op: 'create_draft', params: {} }], { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(summarizeScript(null), null);
});
