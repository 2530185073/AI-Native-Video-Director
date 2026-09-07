import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContactSheet, probeRender, reviewContactSheet, reviewRender, reviewTimestamps } from '../src/review.js';
import { STATIC_FILL_REASON } from '../src/director/lint.js';
import { fixture, samplePlan } from './helpers/fixture.js';

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('reviewTimestamps scrubs to the hook, every beat, the middle and the ending', () => {
  const { chunks, duration } = fixture();
  const plan = samplePlan(chunks);
  plan.beats.push({ type: 'zoom', fromChunk: 9, toChunk: 10, scale: 1.08, sfx: null, reason: STATIC_FILL_REASON });
  const times = reviewTimestamps({ plan, chunks, duration });
  assert.equal(times[0].label, 'hook 0.6s');
  assert.equal(times[0].time, 0.6);
  assert.ok(times.some(pick => pick.label.includes('punch「一万块」')));
  assert.ok(times.some(pick => pick.label === 'broll fullscreen'));
  assert.ok(times.some(pick => pick.label.includes('(fill)')));
  assert.ok(times.some(pick => pick.label === 'middle'));
  assert.equal(times.at(-1).label, 'ending');
  assert.ok(times.at(-1).time <= duration - 0.2 + 1e-9);
  for (let index = 1; index < times.length; index += 1) assert.ok(times[index].time >= times[index - 1].time, 'sorted');
  assert.ok(reviewTimestamps({ plan, chunks, duration, maxFrames: 4 }).length <= 4);
});

test('reviewContactSheet grades the sheet through a vision-capable LLM and tolerates providers without one', async () => {
  const { chunks } = fixture();
  const plan = samplePlan(chunks);
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const sheet = join(dir, 'sheet.jpg');
  execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(sheet)}, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))`]);
  const calls = [];
  const llm = {
    model: 'gemini-test',
    async generateContent({ user, parts, generationConfig }) {
      calls.push({ user, parts, generationConfig });
      return { content: '```json\n{"scores":{"hook":5,"readability":4,"faceClearance":5,"safeZone":4,"rhythm":4,"styleConsistency":5},"overall":4,"verdict":"ship","issues":[{"at":"3.2s","problem":"花字略高","fix":"下移"}],"summary":"可发"}\n```', usage: { totalTokenCount: 10 } };
    }
  };
  const frames = [{ time: 0.6, label: 'hook 0.6s', file: sheet }];
  const review = await reviewContactSheet({ llm, sheetPath: sheet, frames, plan, brief: { platform: '抖音' } });
  assert.equal(review.verdict, 'ship');
  assert.equal(review.overall, 4);
  assert.equal(review.model, 'gemini-test');
  assert.equal(calls[0].parts[0].inline_data.mime_type, 'image/jpeg');
  assert.ok(calls[0].parts[0].inline_data.data.length > 0);
  assert.ok(calls[0].user.includes('一万块'), 'plan summary is in the prompt');
  assert.ok(calls[0].user.includes('抖音'), 'brief is in the prompt');
  assert.equal(calls[0].generationConfig.responseMimeType, 'application/json');

  assert.equal(await reviewContactSheet({ llm: { generateJson: async () => ({}) }, sheetPath: sheet, frames, plan }), null);
});

test('buildContactSheet tiles frames from a real mp4 (skipped without ffmpeg)', { skip: !hasFfmpeg() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const video = join(dir, 'render.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=270x480:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '6', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video], { stdio: 'ignore' });
  const times = [{ time: 0.6, label: 'hook' }, { time: 2.5, label: 'middle' }, { time: 5, label: 'ending' }];
  const result = await buildContactSheet({ videoPath: video, times, outDir: dir, frameWidth: 90, columns: 2 });
  assert.ok(result, 'ffmpeg present → sheet produced');
  assert.equal(result.frames.length, 3);
  assert.ok(existsSync(result.sheet) && statSync(result.sheet).size > 0);
  for (const frame of result.frames) assert.ok(existsSync(frame.file));

  // The technical gate: right canvas + right length + sound → ok; anything else is a concrete problem.
  const good = await probeRender({ videoPath: video, canvas: { width: 270, height: 480 }, duration: 6 });
  assert.ok(good.ok, `probe should pass: ${good.problems.join('; ')}`);
  assert.equal(good.width, 270);
  assert.ok(good.audioCodec, 'audio stream detected');
  const bad = await probeRender({ videoPath: video, canvas: { width: 1080, height: 1920 }, duration: 20 });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(problem => problem.includes('canvas is 270x480')));
  assert.ok(bad.problems.some(problem => problem.includes('duration')));

  // Whole pass with a local file URL stand-in: download is skipped when render.mp4 already exists.
  const { chunks, duration } = fixture();
  const plan = samplePlan(chunks);
  const logs = [];
  const qc = await reviewRender({ videoUrl: 'https://unused.test/x.mp4', plan, chunks, duration: Math.min(duration, 6), canvas: { width: 270, height: 480 }, outDir: dir, llm: null, logger: message => logs.push(message) });
  assert.ok(qc.probe?.ok, 'gate passed');
  assert.ok(qc.sheet && qc.frames.length >= 3);
  assert.equal(qc.review, null);
  assert.ok(logs.some(line => line.includes('sheet only')));

  // A different render URL invalidates the cached mp4 (the fix round must not grade the first cut).
  const bytes = readFileSync(video);
  let fetched = 0;
  const serveLocal = async () => { fetched += 1; return new Response(bytes, { status: 200 }); };
  const again = await reviewRender({ videoUrl: 'https://unused.test/y.mp4', plan, chunks, duration: Math.min(duration, 6), canvas: { width: 270, height: 480 }, outDir: dir, llm: null, logger: () => {}, fetchImpl: serveLocal });
  assert.equal(fetched, 1, 'new URL → re-downloaded');
  assert.ok(again.probe?.ok);
  assert.equal(readFileSync(join(dir, 'render.url'), 'utf8'), 'https://unused.test/y.mp4');
  await reviewRender({ videoUrl: 'https://unused.test/y.mp4', plan, chunks, duration: Math.min(duration, 6), canvas: { width: 270, height: 480 }, outDir: dir, llm: null, logger: () => {}, fetchImpl: serveLocal });
  assert.equal(fetched, 1, 'same URL → cached');

  // A render on the wrong canvas never reaches the (expensive) vision step.
  const gated = await reviewRender({ videoUrl: 'https://unused.test/y.mp4', plan, chunks, duration: Math.min(duration, 6), canvas: { width: 1080, height: 1920 }, outDir: dir, llm: null, logger: () => {} });
  assert.equal(gated.review.verdict, 'fix');
  assert.equal(gated.sheet, null);
  assert.ok(gated.review.issues[0].problem.includes('canvas'));
});
