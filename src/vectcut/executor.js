import { computeImageScale } from './scale.js';

const CLIENT_METHODS = {
  add_video: 'addVideo',
  add_audio: 'addAudio',
  add_image: 'addImage',
  add_text: 'addText',
  add_batch_text: 'addBatchText',
  add_video_keyframe: 'addVideoKeyframe',
  add_effect: 'addEffect',
  add_text_template: 'addTextTemplate'
};

/**
 * Summarise a `query_script` payload so humans (and the review step) can sanity
 * check the draft without reading the raw 剪映 JSON.
 */
export function summarizeScript(script) {
  if (!script || typeof script !== 'object') return null;
  const tracks = (script.tracks || []).map(track => ({
    name: track.name,
    type: track.type,
    segments: (track.segments || []).length
  }));
  return {
    durationSec: script.duration ? script.duration / 1e6 : null,
    fps: script.fps,
    canvas: script.canvas_config,
    tracks,
    texts: (script.materials?.texts || []).length,
    images: (script.materials?.videos || []).filter(item => item.type === 'photo' || item.type === 'image').length,
    videos: (script.materials?.videos || []).filter(item => item.type === 'video').length,
    effects: (script.materials?.video_effects || []).length
  };
}

/**
 * Execute compiled operations against VectCut.
 *
 * - `optional` ops (effects, BGM) log a warning instead of aborting.
 * - ops with a `fallback` list are retried item-by-item (batch subtitles).
 * - `broll_image` ops are resolved through the image provider, then placed.
 * - `dryRun` returns the operation list untouched for inspection.
 */
export async function executeOps(ops, { client, imageProvider, dryRun = false, logger = () => {}, canvas } = {}) {
  if (dryRun) return { dryRun: true, ops, draftId: null, draftUrl: null, warnings: [], results: [] };
  if (!client) throw new Error('a VectCut client is required to execute operations');

  const warnings = [];
  const results = [];
  const assets = [];
  let draftId = null;
  let draftUrl = null;
  let verification = null;

  const withDraft = params => ({ ...params, draft_id: draftId });

  const runClientOp = async op => {
    const method = CLIENT_METHODS[op.op];
    if (!method) throw new Error(`no client method for op ${op.op}`);
    const output = await client[method](withDraft(op.params));
    if (output?.draft_url) draftUrl = output.draft_url;
    return output;
  };

  for (const [index, op] of ops.entries()) {
    const label = `${index + 1}/${ops.length} ${op.op}${op.note ? ` — ${op.note}` : ''}`;
    try {
      if (op.op === 'create_draft') {
        const output = await client.createDraft(op.params);
        draftId = output.draft_id;
        draftUrl = output.draft_url;
        logger(`${label}: ${draftId}`);
        results.push({ op: op.op, ok: true, output });
        continue;
      }
      if (!draftId) throw new Error('create_draft must run before other operations');

      if (op.op === 'query_script') {
        const script = await client.queryScript(draftId);
        verification = summarizeScript(script);
        logger(`${label}: ${JSON.stringify(verification)}`);
        results.push({ op: op.op, ok: true, output: verification });
        continue;
      }

      if (op.op === 'broll_image') {
        if (!imageProvider) {
          warnings.push(`skipped B-roll (no image provider configured): ${op.note || op.prompt}`);
          results.push({ op: op.op, ok: false, skipped: true });
          continue;
        }
        const fullPrompt = op.stylePrompt ? `${op.prompt}\n\n风格要求：${op.stylePrompt}` : op.prompt;
        const image = await imageProvider.generate({ prompt: fullPrompt, aspect: op.aspect });
        assets.push({ ...image, prompt: op.prompt, start: op.params.start, end: op.params.end });
        const scale = computeImageScale({ image, canvas: canvas || { width: op.params.width, height: op.params.height }, target: op.target, fit: op.target.fit });
        const output = await client.addImage(withDraft({ ...op.params, image_url: image.url, scale_x: scale, scale_y: scale }));
        if (output?.draft_url) draftUrl = output.draft_url;
        logger(`${label}: image ${image.url.slice(0, 80)} scale ${scale}`);
        results.push({ op: op.op, ok: true, output, image });
        continue;
      }

      const output = await runClientOp(op);
      logger(`${label}: ok`);
      results.push({ op: op.op, ok: true, output });
    } catch (error) {
      if (op.fallback?.length) {
        warnings.push(`${op.op} failed (${error.message}); falling back to ${op.fallback.length} individual call(s)`);
        let failures = 0;
        for (const item of op.fallback) {
          try {
            await runClientOp(item);
          } catch (inner) {
            failures += 1;
            warnings.push(`fallback ${item.op} failed: ${inner.message}`);
          }
        }
        results.push({ op: op.op, ok: failures === 0, fallback: true, failures });
        continue;
      }
      if (op.optional) {
        warnings.push(`${op.op} skipped: ${error.message}`);
        results.push({ op: op.op, ok: false, error: error.message });
        continue;
      }
      error.draftId = draftId;
      error.draftUrl = draftUrl;
      error.completedOps = results;
      throw error;
    }
  }

  return { dryRun: false, ops, draftId, draftUrl, warnings, results, assets, verification };
}
