// MVP pipeline: video -> ASR -> AI director -> VectCut draft

import { processAsrSubtitles } from '../asr/index.js';
import { createEditingPlan } from '../agent/planner.js';
import { createVectCutDraft } from '../editing/vectcut-client.js';

export async function generateVideoDraft(input) {
  const asr = await processAsrSubtitles({
    audioUrl: input.videoUrl,
    referenceText: input.script,
    language: input.language || 'zh'
  });

  const plan = await createEditingPlan({
    script: input.script,
    subtitles: asr.pipelineSrt,
    assets: input.assets || [],
    style: input.style || 'viral-short-video'
  });

  const draft = await createVectCutDraft(plan, {
    apiKey: input.vectcutApiKey
  });

  return {
    asr,
    plan,
    draft
  };
}
