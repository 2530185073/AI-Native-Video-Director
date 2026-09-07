import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignReferenceWithWhisper,
  parseSrt,
  planDebreath,
  processAsrSubtitles
} from '../src/asr/index.js';

test('aligns reference sentences to Whisper word timestamps', () => {
  const result = alignReferenceWithWhisper('今天介绍银元。请注意重量。', [
    { word: '今天', start: 0, end: 0.4 },
    { word: '介绍', start: 0.4, end: 0.8 },
    { word: '银元', start: 0.8, end: 1.2 },
    { word: '请注意', start: 1.5, end: 1.9 },
    { word: '重量', start: 1.9, end: 2.3 }
  ]);
  const cues = parseSrt(result.srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, '今天介绍银元。');
  assert.equal(cues[1].text, '请注意重量。');
  assert.equal(cues[0].start, 0);
  assert.ok(cues[0].end > cues[0].start);
  assert.ok(cues[1].start >= cues[0].end);
  assert.ok(result.stats[0].coverage > 0.9);
});

test('plans retained segments and a compressed timeline for long gaps', () => {
  const plan = planDebreath({
    words: [
      { start: 0, end: 1 },
      { start: 1.8, end: 2.5 },
      { start: 3, end: 4 }
    ],
    totalDuration: 4,
    threshold: 0.4,
    keepGap: 0.15
  });
  assert.equal(plan.removed, 1);
  assert.equal(plan.newDuration, 3);
  assert.equal(plan.segments.length, 3);
  assert.equal(plan.remap(3), 2);
});

test('pipeline remaps subtitles after debreath processing', async () => {
  const result = await processAsrSubtitles({
    referenceText: '第一句。第二句。',
    transcription: {
      duration: 4,
      words: [
        { word: '第一句', start: 0, end: 1 },
        { word: '第二句', start: 2, end: 3 }
      ],
      srt: '1\n00:00:00,000 --> 00:00:01,000\n第一句。\n\n2\n00:00:02,000 --> 00:00:03,000\n第二句。\n'
    },
    debreathEnabled: true,
    debreathThreshold: 0.4,
    debreathKeepGap: 0.15
  });
  assert.ok(result.alignedSrt);
  assert.ok(result.debreath);
  assert.ok(result.debreath.removedSec > 0);
  assert.notEqual(result.pipelineSrt, result.finalSrt);
});
