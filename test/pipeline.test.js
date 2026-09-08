import assert from 'node:assert/strict';
import test from 'node:test';
import { directSecondCut } from '../src/pipeline.js';
import { buildChunks } from '../src/timeline/chunker.js';
import { SCRIPT, syntheticWords, samplePlan, mockLLM, mockVectCut, mockImageProvider } from './helpers/fixture.js';

test('directSecondCut runs end to end with inline words and mocked services', async () => {
  const { words, duration } = syntheticWords();
  const { chunks } = buildChunks({ script: SCRIPT, words, totalDuration: duration });
  const llm = mockLLM([samplePlan(chunks)]);
  const vectcut = mockVectCut();
  const imageProvider = mockImageProvider();
  const logs = [];

  const result = await directSecondCut({
    videoUrl: 'https://cdn.test/first-cut.mp4',
    audioUrl: 'https://cdn.test/voice.mp3',
    script: SCRIPT,
    words,
    brief: { platform: '抖音', goal: '涨粉', brand: { primaryColor: '#FFE14D' } },
    person: { x: 0.2, y: 0.2, w: 0.6, h: 0.8 },
    render: true
  }, { llm, vectcut, imageProvider, logger: message => logs.push(message) });

  assert.equal(result.timeline.provider, 'inline');
  assert.equal(result.chunks.length, chunks.length);
  assert.equal(result.draft.id, 'dfd_test');
  assert.equal(result.render.status, 'SUCCESS');
  assert.equal(result.assets.length, 1);
  assert.ok(llm.calls[0].includes('抖音'), 'brief reaches the prompt');
  assert.ok(llm.calls[0].includes('26.8克'), 'chunk table reaches the prompt');
  assert.ok(logs.some(line => line.startsWith('compiled:')));
});

test('directSecondCut dry-run needs no VectCut client', async () => {
  const { words, duration } = syntheticWords();
  const { chunks } = buildChunks({ script: SCRIPT, words, totalDuration: duration });
  const result = await directSecondCut({ videoUrl: 'https://cdn.test/a.mp4', script: SCRIPT, words, dryRun: true }, { llm: mockLLM([samplePlan(chunks)]) });
  assert.equal(result.draft.id, null);
  assert.ok(result.ops.length > 4);
});

test('directSecondCut validates required inputs', async () => {
  await assert.rejects(() => directSecondCut({ script: 'x' }, {}), /videoUrl is required/);
  await assert.rejects(() => directSecondCut({ videoUrl: 'u' }, {}), /script is required/);
});
