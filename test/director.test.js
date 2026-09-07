import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanSchema, validatePlan } from '../src/director/schema.js';
import { lintPlan } from '../src/director/lint.js';
import { createEditingPlan, normalizePlan } from '../src/director/planner.js';
import { simplifySchema, extractJson } from '../src/providers/llm/openai-compatible.js';
import { fixture, samplePlan, mockLLM } from './helpers/fixture.js';

test('normalizePlan fills Gemini-omitted type fields and sanitizes wild chunk ids', () => {
  const { chunks } = fixture();
  const raw = {
    concept: '测试包装策略文案',
    tone: 'not-a-real-tone',
    subtitleStyle: samplePlan(chunks).subtitleStyle,
    bgm: 'lofi_clean',
    chunks: [],
    beats: [
      { type: 'zoom', reason: '开场轻推', fromChunk: 1, toChunk: 2 },
      { type: 'broll', reason: '右侧展示翡翠细节', fromChunk: 2, toChunk: 3 },
      { type: 'effect', reason: '开场进场', fromChunk: 1, toChunk: 1 },
      { type: 'punch', reason: '结论', chunkId: 3, text: '分开看' },
      { type: 'zoom', reason: '坏 id', fromChunk: 3.48e99, toChunk: 3.48e99 }
    ]
  };
  const plan = normalizePlan(structuredClone(raw), chunks);
  assert.equal(plan.tone, 'energetic');
  assert.deepEqual(plan.bgm, { track: 'lofi_clean', reason: '模型直接给出曲目' });
  assert.equal(plan.chunks.length, chunks.length);

  const zoom = plan.beats.find(beat => beat.type === 'zoom' && beat.fromChunk === 1);
  assert.equal(zoom.scale, 1.12);

  const broll = plan.beats.find(beat => beat.type === 'broll');
  assert.equal(broll.layout, 'pip_side');
  assert.ok(broll.prompt.includes('右侧展示翡翠细节'));

  const effect = plan.beats.find(beat => beat.type === 'effect');
  assert.ok(effect.name);

  const punch = plan.beats.find(beat => beat.type === 'punch');
  assert.equal(punch.color, plan.subtitleStyle.highlightColor);
  assert.equal(punch.position, 'above_head');

  const wild = plan.beats.find(beat => beat.type === 'zoom' && beat.reason === '坏 id');
  assert.equal(wild.fromChunk, chunks.at(-1).id);
  assert.equal(validatePlan(plan, { chunks }).length, 0);
});

test('a well-formed plan validates; catalog violations and bad references are caught', () => {
  const { chunks } = fixture();
  const plan = samplePlan(chunks);
  assert.deepEqual(validatePlan(plan, { chunks }), []);

  const badEnum = structuredClone(plan);
  badEnum.beats[0].intro = '不存在的动画';
  assert.ok(validatePlan(badEnum, { chunks }).some(error => error.includes('beats[0].intro')));

  const badRef = structuredClone(plan);
  badRef.beats[1].toChunk = 999;
  assert.ok(validatePlan(badRef, { chunks }).some(error => error.includes('unknown chunk 999')));

  const missing = structuredClone(plan);
  delete missing.beats[2].prompt;
  assert.ok(validatePlan(missing, { chunks }).some(error => error.includes('prompt: required for type "broll"')));

  const badColor = structuredClone(plan);
  badColor.subtitleStyle.highlightColor = 'yellow';
  assert.ok(validatePlan(badColor, { chunks }).some(error => error.includes('highlightColor')));

  const badSfx = structuredClone(plan);
  badSfx.beats[0].sfx = 'airhorn';
  assert.ok(validatePlan(badSfx, { chunks }).some(error => error.includes('beats[0].sfx')));

  const badBgm = structuredClone(plan);
  badBgm.bgm.track = 'https://example.com/song.mp3';
  assert.ok(validatePlan(badBgm, { chunks }).some(error => error.includes('bgm.track')));
});

test('lint keeps sound effects sparse: no two within a breath, capped per minute', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  plan.beats = [
    { type: 'punch', chunkId: 1, text: chunks[0].text.slice(0, 2), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: 'pop', reason: 'a' },
    { type: 'zoom', fromChunk: 1, toChunk: 2, scale: 1.1, sfx: 'whoosh', reason: 'same instant as the punch' },
    { type: 'broll', fromChunk: 3, toChunk: 3, prompt: '一枚银元特写照片，写实', layout: 'card_top', imageIntro: '放大', outro: null, sfx: 'whoosh', reason: 'b' },
    { type: 'punch', chunkId: 5, text: chunks[4].text.slice(0, 2), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: 'pop', reason: 'c' },
    { type: 'zoom', fromChunk: 7, toChunk: 7, scale: 1.1, sfx: 'whoosh', reason: 'd' },
    { type: 'punch', chunkId: 9, text: chunks[8].text.slice(0, 2), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: 'ding', reason: 'e' },
    { type: 'effect', fromChunk: 11, toChunk: 11, name: '星光', sfx: 'click', reason: 'f' }
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration });
  const zoom = linted.beats.find(beat => beat.type === 'zoom' && beat.fromChunk === 1);
  assert.equal(zoom.sfx, null, 'second sfx at the same instant is dropped');
  assert.ok(warnings.some(warning => warning.includes('within 0.7s')));
  const withSfx = linted.beats.filter(beat => beat.sfx);
  assert.ok(withSfx.length <= 3, `expected ≤3 sfx for a 22s video, got ${withSfx.length}`);
  assert.ok(warnings.some(warning => warning.startsWith('sfx:')));
});

test('schema simplification keeps structure and drops validation-only keywords', () => {
  const simplified = simplifySchema(buildPlanSchema());
  const json = JSON.stringify(simplified);
  assert.ok(!json.includes('pattern'));
  assert.ok(!json.includes('additionalProperties'));
  assert.ok(!json.includes('null,') || !json.includes('"enum":[null'), 'null removed from enums');
  assert.ok(simplified.properties.beats.items.properties.type.enum.includes('punch'));
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('noise {"a":[1,2]} trailing'), { a: [1, 2] });
});

test('lint drops bogus highlights, thins over-dense beats and removes overlaps', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  plan.chunks[0].highlights = ['不在文本里', '很多人'];
  // 12 punches in a 22s clip is far above 8/min.
  plan.beats = chunks.map(chunk => ({ type: 'punch', chunkId: chunk.id, text: chunk.text.slice(0, 3), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, reason: 'x' }));
  plan.beats.push({ type: 'broll', fromChunk: 3, toChunk: 5, prompt: '一枚银元特写照片，写实', layout: 'card_top', imageIntro: '放大', outro: null, reason: 'a' });
  plan.beats.push({ type: 'broll', fromChunk: 4, toChunk: 6, prompt: '另一张银元照片，写实', layout: 'fullscreen', imageIntro: '放大', outro: null, reason: 'b' });

  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration });
  assert.deepEqual(linted.chunks[0].highlights, ['很多人']);
  const punches = linted.beats.filter(beat => beat.type === 'punch');
  assert.ok(punches.length <= 3, `expected thinning, got ${punches.length}`);
  assert.equal(linted.beats.filter(beat => beat.type === 'broll').length, 1);
  assert.ok(warnings.some(warning => warning.includes('overlaps an earlier broll')));
  assert.ok(warnings.some(warning => warning.includes('thinned')));
  const starts = linted.beats.map(beat => beat.chunkId ?? beat.fromChunk);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'beats sorted by time');
});

test('normalizePlan fills missing chunk entries and coerces beat ids', () => {
  const { chunks } = fixture();
  const plan = samplePlan(chunks);
  plan.chunks = plan.chunks.slice(0, 2);
  plan.beats = [{ type: 'zoom', chunkId: 3, scale: 1.1, reason: 'r' }, { type: 'punch', fromChunk: 2, text: '  一万块钱  ', reason: 'r' }];
  const normalized = normalizePlan(plan, chunks);
  assert.equal(normalized.chunks.length, chunks.length);
  assert.equal(normalized.beats[0].fromChunk, 3);
  assert.equal(normalized.beats[0].toChunk, 3);
  assert.equal(normalized.beats[1].chunkId, 2);
  assert.equal(normalized.beats[1].text, '一万块钱');
  assert.equal(normalized.beats[1].color, '#FFE14D');
});

test('planner repairs an invalid first answer and returns a linted plan', async () => {
  const { chunks, layout, duration, script } = fixture();
  const good = samplePlan(chunks);
  const broken = structuredClone(good);
  broken.beats[0].position = 'nowhere';
  const llm = mockLLM([broken, good]);
  const result = await createEditingPlan({ llm, chunks, script, duration, layout });
  assert.equal(llm.calls.length, 2);
  assert.ok(llm.calls[1].includes('没有通过校验'));
  assert.ok(llm.calls[1].includes('beats[0].position'));
  assert.equal(result.plan.beats.length, good.beats.length);
  assert.equal(result.attempts.length, 2);
});

test('planner gives up with a descriptive error after maxAttempts', async () => {
  const { chunks, layout, duration, script } = fixture();
  const broken = samplePlan(chunks);
  broken.beats[0].intro = '不存在的动画';
  await assert.rejects(
    () => createEditingPlan({ llm: mockLLM([broken, broken]), chunks, script, duration, layout, maxAttempts: 2 }),
    error => error.message.includes('after 2 attempts') && Array.isArray(error.errors)
  );
});
