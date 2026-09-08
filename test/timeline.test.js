import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWords } from '../src/timeline/words.js';
import { buildChunks, phraseTiming, chunkRange } from '../src/timeline/chunker.js';
import { SCRIPT, syntheticWords } from './helpers/fixture.js';

test('normalizeWords accepts nested payloads, milliseconds and SRT', () => {
  const nested = normalizeWords({ code: 0, data: { characters: [{ char: '你', start_time: 100, end_time: 300 }, { char: '好', start_time: 300, end_time: 500 }] } });
  assert.deepEqual(nested, [{ text: '你', start: 0.1, end: 0.3 }, { text: '好', start: 0.3, end: 0.5 }]);

  const seconds = normalizeWords([{ word: 'hi', start: 0.5, end: 0.9 }]);
  assert.deepEqual(seconds, [{ text: 'hi', start: 0.5, end: 0.9 }]);

  const srt = normalizeWords('1\n00:00:01,000 --> 00:00:02,500\n你好\n');
  assert.deepEqual(srt, [{ text: '你好', start: 1, end: 2.5 }]);

  const forced = normalizeWords([{ text: 'a', start: 50, end: 90 }], { timeUnit: 'ms' });
  assert.equal(forced[0].start, 0.05);

  assert.deepEqual(normalizeWords({ nothing: true }), []);
});

test('buildChunks produces short, punctuation-free, monotonic lines with decimals intact', () => {
  const { words, duration } = syntheticWords();
  const { chunks, coverage } = buildChunks({ script: SCRIPT, words, totalDuration: duration });
  assert.ok(coverage > 0.95);
  assert.ok(chunks.length >= 10);
  const texts = chunks.map(chunk => chunk.text);
  assert.ok(texts.includes('标准的袁大头是26.8克'), `decimal kept: ${texts.join(' | ')}`);
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk.text).length <= 14, `too long: ${chunk.text}`);
    assert.ok(!/[，。？！]/.test(chunk.text), `punctuation leaked: ${chunk.text}`);
    assert.ok(chunk.end > chunk.start);
  }
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].start >= chunks[index - 1].end - 0.001, 'chunks must not overlap');
  }
  assert.equal(chunks.map(chunk => chunk.text).join(''), SCRIPT.replace(/[，。？！、]/g, ''));
});

test('buildChunks splits long sentences at the biggest pause and interpolates unmatched text', () => {
  const script = '这是一个非常非常长的句子它中间没有任何标点但是说话的人停顿了一下然后继续讲';
  const { words } = syntheticWords(script);
  // Insert a pause after the 16th character.
  words.forEach((word, index) => { if (index >= 16) { word.start += 0.9; word.end += 0.9; } });
  const { chunks } = buildChunks({ script, words, maxChars: 22 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, '这是一个非常非常长的句子它中间没');
  assert.ok(chunks[1].start > chunks[0].end);

  const partial = buildChunks({ script: '第一句。完全没有对上的第二句。', words: syntheticWords('第一句').words, totalDuration: 4 });
  assert.equal(partial.chunks.length, 2);
  assert.ok(partial.chunks[1].interpolated);
  assert.ok(partial.chunks[1].start >= partial.chunks[0].end);
});

test('phraseTiming finds the spoken moment of a keyword', () => {
  const { words, duration } = syntheticWords();
  const { chunks } = buildChunks({ script: SCRIPT, words, totalDuration: duration });
  const chunk = chunks.find(entry => entry.text.startsWith('一万块'));
  const timing = phraseTiming(chunk, '真银元');
  assert.ok(timing.exact);
  assert.ok(timing.start > chunk.start);
  assert.ok(timing.end <= chunk.end + 0.001);
  const missing = phraseTiming(chunk, '不存在');
  assert.equal(missing.exact, false);
  assert.equal(missing.start, chunk.start);
  assert.deepEqual(chunkRange(chunks, 2, 3), { start: chunks[1].start, end: chunks[2].end });
  assert.equal(chunkRange(chunks, 99), null);
});
