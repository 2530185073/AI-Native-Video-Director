import { alignReferenceWithWhisper } from './alignment.js';
import { planDebreath, remapSrt } from './debreath.js';
import { mergePlainTextIntoSrt, sanitizeSrt, stripPunctuationFromSrt } from './subtitles.js';
import { responseToSrt, transcribeWithGroq } from './whisper.js';

function asBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === 'true';
}

export async function processAsrSubtitles({
  audioUrl,
  referenceText = '',
  language = 'zh',
  transcription,
  alignmentEnabled = asBoolean(process.env.ASR_ALIGNMENT_ENABLED, true),
  debreathEnabled = asBoolean(process.env.ASR_DEBREATH_ENABLED, true),
  debreathThreshold = Number(process.env.ASR_DEBREATH_THRESHOLD || 0.4),
  debreathKeepGap = Number(process.env.ASR_DEBREATH_KEEP_GAP || 0.15),
  ...whisperOptions
} = {}) {
  const asr = transcription || await transcribeWithGroq({
    audioUrl,
    language,
    prompt: referenceText,
    ...whisperOptions
  });
  const words = Array.isArray(asr.words) ? asr.words : Array.isArray(asr.raw?.words) ? asr.raw.words : [];
  const transcriptionSrt = sanitizeSrt(asr.srt || responseToSrt(asr.raw || ''));
  const optimizedSrt = referenceText
    ? sanitizeSrt(mergePlainTextIntoSrt({ srt: transcriptionSrt, plainText: referenceText }))
    : transcriptionSrt;

  let alignedSrt = null;
  let alignmentStats = null;
  if (alignmentEnabled && words.length && referenceText) {
    const alignment = alignReferenceWithWhisper(referenceText, words);
    alignedSrt = sanitizeSrt(alignment.srt);
    alignmentStats = alignment.stats;
  }

  const finalSrt = alignedSrt || optimizedSrt;
  const finalSrtNoPunct = sanitizeSrt(stripPunctuationFromSrt(finalSrt));
  let pipelineSrt = finalSrt;
  let pipelineSrtNoPunct = finalSrtNoPunct;
  let debreath = null;
  const wordEnd = words.reduce((max, word) => Math.max(max, Number(word?.end ?? word?.start ?? 0) || 0), 0);
  const duration = Number(asr.duration || asr.raw?.duration || wordEnd || 0) || null;

  if (debreathEnabled && words.length && duration) {
    const plan = planDebreath({
      words,
      totalDuration: duration,
      threshold: debreathThreshold,
      keepGap: debreathKeepGap
    });
    if (plan?.segments?.length) {
      pipelineSrt = remapSrt(finalSrt, plan);
      pipelineSrtNoPunct = sanitizeSrt(stripPunctuationFromSrt(pipelineSrt));
      debreath = {
        segments: plan.segments.length,
        removedSec: plan.removed,
        oldDuration: duration,
        newDuration: plan.newDuration,
        timeline: plan.segments
      };
    }
  }

  return {
    transcription: asr,
    words,
    duration,
    transcriptionSrt,
    optimizedSrt,
    alignedSrt,
    finalSrt,
    finalSrtNoPunct,
    pipelineSrt,
    pipelineSrtNoPunct,
    alignmentStats,
    debreath
  };
}
