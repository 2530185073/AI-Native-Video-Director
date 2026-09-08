import { normalizeWords } from '../timeline/words.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Word-level alignment through VectCut's own ASR service.
 *
 * When `script` is supplied the task runs in `sta` mode: the service aligns the
 * given text against the audio instead of transcribing freely, which is exactly
 * the "文案 ↔ 音频 逐字对照" step this pipeline needs. Every `segments[].words[]`
 * entry is one character with `start_time`/`end_time` in milliseconds.
 */
export async function alignWithVectCut({
  client,
  audioUrl,
  script,
  effectMode = process.env.VECTCUT_ASR_MODE || 'nlp',
  intervalMs = 4000,
  timeoutMs = 10 * 60000,
  logger = () => {}
} = {}) {
  if (!client) throw new Error('a VectCut client is required for VectCut ASR');
  if (!audioUrl) throw new Error('audioUrl is required for VectCut ASR');

  const submitted = await client.submitAsrTask({ url: audioUrl, effect_mode: effectMode, content: script || undefined });
  const taskId = submitted.task_id;
  if (!taskId) throw new Error(`VectCut ASR did not return a task_id: ${JSON.stringify(submitted).slice(0, 200)}`);
  logger(`vectcut asr task ${taskId} (${script ? 'sta' : 'asr'} / ${effectMode})`);

  const started = Date.now();
  let status;
  while (Date.now() - started < timeoutMs) {
    status = await client.asrTaskStatus(taskId);
    const state = String(status.status || '').toLowerCase();
    if (state === 'success') break;
    if (state === 'failed' || state === 'failure') {
      throw new Error(`VectCut ASR task ${taskId} failed: ${status.result?.error || status.error || status.message}`);
    }
    await sleep(intervalMs);
  }
  if (String(status?.status || '').toLowerCase() !== 'success') throw new Error(`VectCut ASR task ${taskId} timed out`);

  const words = extractVectCutWords(status.result);
  if (!words.length) throw new Error('VectCut ASR returned no word timestamps');
  return { words, raw: status.result, taskId, mode: status.result?.mode, transcript: status.result?.content };
}

/** Flatten `segments[].words[]` (ms) into the pipeline's `[{ text, start, end }]` seconds format. */
export function extractVectCutWords(result) {
  const segments = result?.segments || result?.result?.segments || [];
  const raw = [];
  for (const segment of segments) {
    const list = Array.isArray(segment.words) && segment.words.length ? segment.words : segment.phrase || [];
    for (const word of list) raw.push({ text: word.text, start: word.start_time, end: word.end_time });
  }
  if (!raw.length) {
    const utterances = result?.result?.raw?.result?.utterances || [];
    for (const utterance of utterances) for (const word of utterance.words || []) raw.push({ text: word.text, start: word.start_time, end: word.end_time });
  }
  return normalizeWords(raw, { timeUnit: 'ms' });
}
