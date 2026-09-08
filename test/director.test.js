import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPlanSchema, validatePlan } from '../src/director/schema.js';
import { DEFAULT_LIMITS, colorFamily, lintPlan, STATIC_FILL_REASON } from '../src/director/lint.js';
import { flowerById } from '../src/director/catalog.js';
import { createEditingPlan, normalizePlan } from '../src/director/planner.js';
import { chunkRange } from '../src/timeline/chunker.js';
import { DIRECTOR_SYSTEM_PROMPT, loadDirectorSkill, rhythmBudget, scriptDensity } from '../src/director/prompt.js';
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
  assert.deepEqual(plan.bgm, { track: 'talk_default', reason: '模型直接给出曲目' });
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
    { type: 'zoom', fromChunk: 1, toChunk: 2, scale: 1.1, sfx: 'whoosh_soft', reason: 'same instant as the punch' },
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
  // Sound grammar: a whoosh belongs to pictures and pushes, not to a bare zoom → dropped.
  const laterZoom = linted.beats.find(beat => beat.type === 'zoom' && beat.fromChunk === 7);
  assert.equal(laterZoom.sfx, null);
  assert.ok(warnings.some(warning => warning.includes('does not fit a zoom beat')));
  const withSfx = linted.beats.filter(beat => beat.sfx);
  assert.ok(withSfx.length <= 3, `expected ≤3 sfx for a 22s video, got ${withSfx.length}`);
  assert.ok(warnings.some(warning => warning.startsWith('sfx:')));
});

test('director system prompt is the SKILL.md knowledge pack without front-matter or source notes', () => {
  const skill = loadDirectorSkill();
  assert.ok(skill && skill.length > 1000);
  assert.equal(DIRECTOR_SYSTEM_PROMPT, skill);
  assert.ok(!skill.startsWith('---'), 'front-matter stripped');
  assert.ok(!/来源与依据/.test(skill), 'maintainer notes stripped');
  assert.ok(skill.includes('前 3 秒不放全屏 B-roll'));
  assert.ok(skill.includes('只输出 JSON'));
  assert.ok(skill.includes('W0BpSlRRRldCZlhQTFpAaERcUw=='), 'portable skill embeds flower IDs');
  assert.ok(skill.includes('talk_default'), 'portable skill embeds default BGM id');
  assert.equal(loadDirectorSkill('/nonexistent/SKILL.md'), null);

  const { chunks, duration } = fixture();
  const budget = rhythmBudget(duration, chunks);
  assert.match(budget, /punch 约 \d+-\d+ 个/);
  assert.ok(budget.includes(`片段 ${chunks[0].id} 应有 punch`));
  assert.ok(budget.includes('死中段'), '22s clip still has a 12-19s middle');
});

test('portable skill example plan is schema-valid for other models to copy', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const plan = JSON.parse(readFileSync(resolve(root, 'skills/talking-head-second-cut/examples/plan.example.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(resolve(root, 'skills/talking-head-second-cut/catalog.json'), 'utf8'));
  const chunks = [
    { id: 1, text: '你以为真银元很贵？' },
    { id: 2, text: '一枚流通品大概一万块。' },
    { id: 3, text: '看币，越看越懂。' }
  ];
  assert.equal(validatePlan(plan, { chunks }).length, 0);
  assert.ok(catalog.punch.flowerId.some(item => item.id === 'W0BpSlRRRldCZlhQTFpAaERcUw=='));
  assert.equal(plan.bgm.track, 'talk_default');
  assert.equal(plan.subtitleStyle.background.enabled, false);
});

test('lint applies the editing doctrine: hook stays on the face, zooms breathe, static stretches get a gentle push', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  const last = chunks[chunks.length - 1];
  plan.beats = [
    // Fullscreen cutaway inside the 3s hook → downgraded, never dropped.
    { type: 'broll', fromChunk: 1, toChunk: 2, prompt: '一枚银元特写照片，写实', layout: 'fullscreen', imageIntro: '放大', outro: null, sfx: 'ding', reason: 'hook picture' },
    // A zoom shorter than 2s is stretched over the next line instead of flashing.
    { type: 'zoom', fromChunk: 3, toChunk: 3, scale: 1.12, sfx: null, reason: 'short' },
    // Starts right after the previous zoom ends → habituation, dropped.
    { type: 'zoom', fromChunk: 5, toChunk: 5, scale: 1.12, sfx: null, reason: 'back to back' },
    // Two punches on one line → only the first survives.
    { type: 'punch', chunkId: 4, text: chunks[3].text.slice(0, 2), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: 'whoosh', reason: 'first big word' },
    { type: 'punch', chunkId: 4, text: chunks[3].text.slice(1, 3), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: null, reason: 'second big word' }
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration });

  const broll = linted.beats.find(beat => beat.type === 'broll');
  assert.equal(broll.layout, 'card_top');
  assert.equal(broll.sfx, 'whoosh', 'a ding on a picture is re-voiced as a whoosh');
  assert.ok(warnings.some(warning => warning.includes('hook')));

  const zooms = linted.beats.filter(beat => beat.type === 'zoom' && beat.reason !== STATIC_FILL_REASON);
  assert.equal(zooms.length, 1, 'back-to-back zoom dropped');
  assert.ok(zooms[0].toChunk > 3, 'short zoom extended');
  const zoomRange = chunkRange(chunks, zooms[0].fromChunk, zooms[0].toChunk);
  assert.ok(zoomRange.end - zoomRange.start >= DEFAULT_LIMITS.minZoomSeconds);

  const punches = linted.beats.filter(beat => beat.type === 'punch');
  assert.equal(punches.length, 1);
  assert.equal(punches[0].sfx, 'pop', 'a whoosh on a word becomes a pop');

  // The tail of the clip (after chunk 5) has nothing on screen for > 8s → one gentle fill zoom.
  const fills = linted.beats.filter(beat => beat.reason === STATIC_FILL_REASON);
  assert.ok(fills.length >= 1, 'static stretch filled');
  for (const fill of fills) {
    assert.equal(fill.scale, DEFAULT_LIMITS.staticFillScale);
    assert.ok(fill.fromChunk >= 6 && fill.toChunk <= last.id);
  }
  assert.ok(warnings.some(warning => warning.includes('no visual change')));
  assert.equal(validatePlan(linted, { chunks }).length, 0, 'linted plan is still schema-valid (--from-plan round trip)');
});

test('lint unifies punch looks and keeps big words off the pictures', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  const punch = (chunkId, style, position = 'above_head') => ({ type: 'punch', chunkId, text: chunks[chunkId - 1].text.slice(0, 2), fontSize: 18, intro: '弹入', loop: null, position, outro: null, sfx: null, reason: 'big word here', ...style });
  plan.beats = [
    punch(2, { flowerId: 'W0BpSlRRRldCZlhQTFpAaERcUw==', color: null }),
    punch(4, { flowerId: 'W0BpSlRRRldCZlhQTFpAaERcUw==', color: null }),
    punch(6, { flowerId: 'W0BmQFNaQVJBbFlRTVlLbkBdUA==', color: null }),
    punch(8, { flowerId: null, color: '#3366FF' }),
    punch(10, { flowerId: null, color: '#FFFFFF' }, 'chest'),
    { type: 'broll', fromChunk: 10, toChunk: 11, prompt: '一枚银元特写照片，写实', layout: 'lower_card', imageIntro: '放大', outro: null, sfx: null, reason: 'data card' }
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration, limits: { ...DEFAULT_LIMITS, punchPerMinute: 30 } });
  const punches = linted.beats.filter(beat => beat.type === 'punch');
  assert.equal(punches.length, 5);
  const looks = new Set(punches.map(beat => beat.flowerId || beat.color));
  assert.ok(looks.size <= 2, `expected ≤2 looks, got ${[...looks]}`);
  assert.ok(punches.filter(beat => beat.flowerId === 'W0BpSlRRRldCZlhQTFpAaERcUw==').length >= 4, 'strays restyled to the dominant flower');
  assert.ok(warnings.some(warning => warning.includes('different looks')));

  const onCard = punches.find(beat => beat.chunkId === 10);
  assert.equal(onCard.position, 'top', 'a chest punch over a lower_card picture moves to the top');
  assert.ok(warnings.some(warning => warning.includes('lower_card picture')));
});

test('lint keeps the face on screen for the closing line and lets only one punch be the loudest', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  const last = chunks[chunks.length - 1];
  const beforeLast = chunks[chunks.length - 2];
  const twoBeforeLast = chunks[chunks.length - 3];
  const punch = (chunkId, extra) => ({ type: 'punch', chunkId, text: chunks[chunkId - 1].text.slice(0, 2), flowerId: null, color: '#FFFFFF', fontSize: 22, intro: '弹入', loop: null, position: 'above_head', outro: null, sfx: null, reason: 'big word here', ...extra });
  plan.beats = [
    // Runs into the last line → trimmed so the conclusion is spoken to camera.
    { type: 'broll', fromChunk: twoBeforeLast.id, toChunk: last.id, prompt: '一枚银元特写照片，写实', layout: 'fullscreen', imageIntro: null, outro: null, sfx: null, reason: 'object' },
    // Starts on the last line → cannot be trimmed, becomes a card that leaves the face visible.
    { type: 'broll', fromChunk: last.id, toChunk: last.id, prompt: '一枚银元特写照片，写实', layout: 'pip_face', imageIntro: null, outro: null, sfx: null, reason: 'object' },
    punch(2, { sfx: 'pop' }),
    punch(4, { sfx: 'ding', text: '26.8' }),
    punch(6, {})
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration, limits: { ...DEFAULT_LIMITS, punchPerMinute: 30, brollPerMinute: 30, maxBrollRatio: 1 } });

  const brolls = linted.beats.filter(beat => beat.type === 'broll');
  const trimmed = brolls.find(beat => beat.fromChunk === twoBeforeLast.id);
  assert.equal(trimmed.layout, 'fullscreen');
  assert.equal(trimmed.toChunk, beforeLast.id, 'covering picture ends before the closing line');
  const onClosing = brolls.find(beat => beat.fromChunk === last.id);
  assert.ok(onClosing, 'the beat is kept, not dropped');
  assert.equal(onClosing.layout, 'lower_card', 'a picture that starts on the closing line becomes a card');
  assert.ok(warnings.filter(warning => warning.includes('closing line')).length >= 2);

  const punches = linted.beats.filter(beat => beat.type === 'punch');
  const loudest = punches.filter(beat => beat.fontSize === 22);
  assert.equal(loudest.length, 1, 'exactly one apex');
  assert.equal(loudest[0].chunkId, 4, 'the ding-backed number is the payoff');
  for (const beat of punches) if (beat.chunkId !== 4) assert.equal(beat.fontSize, 22 - DEFAULT_LIMITS.apexStep);
  assert.ok(warnings.some(warning => warning.includes('apex')));
  assert.equal(validatePlan(linted, { chunks }).length, 0);
});

test('lint keeps punch text to white + the highlight colour, including the colour baked into flower presets', () => {
  assert.equal(colorFamily('#FFD93D'), 'yellow');
  assert.equal(colorFamily('#FFFFFF'), 'white');
  assert.equal(colorFamily('#3366FF'), 'blue');
  assert.equal(colorFamily('#E53935'), 'red');
  assert.equal(colorFamily('#00E676'), 'green');

  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  const punch = (chunkId, style) => ({ type: 'punch', chunkId, text: chunks[chunkId - 1].text.slice(0, 2), fontSize: 18, intro: '弹入', loop: null, position: 'chest', outro: null, sfx: null, reason: 'big word here', ...style });
  const blueKnowledge = 'WkpuRFxRQlBNalpSS19IaUNSVg==';
  const whiteOutline = 'W0BtRFRVQlRAa19XSFpBa0tWUQ==';
  const green = 'WktrQVNSR1FDaFJXQFVObUVcVA==';
  plan.subtitleStyle.highlightColor = '#FFD93D';
  plan.beats = [
    punch(2, { flowerId: blueKnowledge, color: null }),
    punch(4, { flowerId: whiteOutline, color: null }),
    punch(6, { flowerId: null, color: '#3366FF' }),
    punch(8, { flowerId: null, color: '#FFFFFF' }),
    punch(10, { flowerId: green, color: null })
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration, limits: { ...DEFAULT_LIMITS, punchPerMinute: 30, maxPunchStyles: 10 } });
  const byChunk = Object.fromEntries(linted.beats.filter(beat => beat.type === 'punch').map(beat => [beat.chunkId, beat]));
  assert.equal(flowerById(byChunk[2].flowerId).hue, 'yellow', 'blue knowledge preset swapped for a yellow one');
  assert.equal(byChunk[4].flowerId, whiteOutline, 'white-outline preset goes with any accent');
  assert.equal(byChunk[6].color, '#FFD93D', 'plain blue recoloured to the accent');
  assert.equal(byChunk[8].color, '#FFFFFF', 'white stays');
  assert.equal(flowerById(byChunk[10].flowerId).hue, 'yellow', 'green preset swapped too');
  assert.equal(warnings.filter(warning => warning.includes('preset')).length, 2);
  assert.ok(warnings.some(warning => warning.includes('off-palette')));
  assert.equal(validatePlan(linted, { chunks }).length, 0);
});

test('lint keeps subtitle black bars off even when the footage has a busy lower third', () => {
  const { chunks, layout, duration } = fixture();
  const source = { lowerThirdBusy: true, lowerThirdReason: '黑色短袖胸前有白色英文印花' };

  const off = samplePlan(chunks);
  off.subtitleStyle.background = { enabled: false };
  const keptOff = lintPlan(off, { chunks, layout, duration, source });
  assert.equal(keptOff.plan.subtitleStyle.background.enabled, false);

  const on = samplePlan(chunks);
  on.subtitleStyle.background = { enabled: true, color: '#000000', alpha: 0.45 };
  const forcedOff = lintPlan(on, { chunks, layout, duration, source });
  assert.equal(forcedOff.plan.subtitleStyle.background.enabled, false, 'product lock strips the black bar');
  assert.ok(forcedOff.warnings.some(warning => /black bar|subtitle bar|底/.test(warning) || warning.includes('product lock')));
});

test('lint lifts chest punches to the top so they do not stack on subtitles', () => {
  const { chunks, layout, duration } = fixture();
  const plan = samplePlan(chunks);
  plan.beats = [
    { type: 'punch', chunkId: chunks[2].id, text: chunks[2].text.slice(0, 2), flowerId: null, color: '#FFE14D', fontSize: 18, intro: '弹入', loop: null, position: 'chest', outro: null, sfx: null, reason: 'big word' }
  ];
  const { plan: linted, warnings } = lintPlan(plan, { chunks, layout, duration });
  const punch = linted.beats.find(beat => beat.type === 'punch');
  assert.equal(punch.position, 'top');
  assert.ok(warnings.some(warning => warning.includes('chest') && warning.includes('top')));
});

test('rhythm budget scales with script density', () => {
  const { chunks, duration, script } = fixture();
  const dense = scriptDensity(script, duration);
  assert.ok(dense.hits >= 5, `numbers and enumerations counted (${dense.hits})`);
  assert.equal(dense.level, 'high', 'a 22s script with prices, a weight and 第一/第二/第三 is dense');
  const sparse = scriptDensity('那天晚上我一个人走在回家的路上，风很大，我想了很多以前的事情，然后慢慢就释怀了。', 60);
  assert.equal(sparse.level, 'low');
  assert.ok(sparse.multiplier < 1 && dense.multiplier > 1);

  const budget = rhythmBudget(duration, chunks, { script });
  assert.ok(budget.includes('信息密度高'));
  assert.ok(budget.includes('apex'), 'the one-apex rule is spelled out to the director');
  assert.ok(budget.includes('最后一句'), 'closing line protection is spelled out too');
  const denseCount = Number(/punch 约 (\d+)-/.exec(budget)[1]);
  const sparseBudget = rhythmBudget(duration, chunks, { script: '那天晚上我一个人走在回家的路上，风很大，我想了很多以前的事情。' });
  const sparseCount = Number(/punch 约 (\d+)-/.exec(sparseBudget)[1]);
  assert.ok(denseCount >= sparseCount, 'a dense script earns at least as many beats');
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
