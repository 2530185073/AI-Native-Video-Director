import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContactSheet, reviewContactSheet, reviewRender, reviewTimestamps } from '../src/review.js';
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
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=270x480:rate=10', '-t', '6', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
  const times = [{ time: 0.6, label: 'hook' }, { time: 2.5, label: 'middle' }, { time: 5, label: 'ending' }];
  const result = await buildContactSheet({ videoPath: video, times, outDir: dir, frameWidth: 90, columns: 2 });
  assert.ok(result, 'ffmpeg present → sheet produced');
  assert.equal(result.frames.length, 3);
  assert.ok(existsSync(result.sheet) && statSync(result.sheet).size > 0);
  for (const frame of result.frames) assert.ok(existsSync(frame.file));

  // Whole pass with a local file URL stand-in: download is skipped when render.mp4 already exists.
  const { chunks, duration } = fixture();
  const plan = samplePlan(chunks);
  const logs = [];
  const qc = await reviewRender({ videoUrl: 'https://unused.test/x.mp4', plan, chunks, duration: Math.min(duration, 6), outDir: dir, llm: null, logger: message => logs.push(message) });
  assert.ok(qc.sheet && qc.frames.length >= 3);
  assert.equal(qc.review, null);
  assert.ok(logs.some(line => line.includes('sheet only')));
});
