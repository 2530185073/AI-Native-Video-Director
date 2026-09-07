import { getWordTimeline } from './asr/timeline.js';
import { buildChunks } from './timeline/chunker.js';
import { createLayout } from './layout/layout.js';
import { createEditingPlan } from './director/planner.js';
import { CATALOG } from './director/catalog.js';
import { compilePlan, summarizeOps } from './vectcut/compiler.js';
import { executeOps } from './vectcut/executor.js';

/**
 * End-to-end "second cut" pipeline for a finished digital-human talking-head video.
 *
 *   inputs ──▶ word timeline ──▶ subtitle chunks ──▶ AI Director plan ──▶ lint
 *          ──▶ VectCut operations ──▶ draft (──▶ cloud render)
 *
 * `deps` lets callers inject the LLM, VectCut client and image provider (tests use
 * mocks; production wires them from environment variables in `cli.js`).
 */
export async function directSecondCut(inputs, deps = {}) {
  const {
    videoUrl,
    audioUrl,
    script,
    words,
    language = 'zh',
    canvas = { width: 1080, height: 1920 },
    person,
    face,
    brief,
    bgmUrl,
    bgmVolumeDb,
    replaceAudio = false,
    name,
    chunking = {},
    render = false,
    renderOptions = {},
    dryRun = false
  } = inputs;
  const { llm, vectcut, imageProvider, logger = () => {}, catalog = CATALOG } = deps;

  if (!videoUrl) throw new Error('videoUrl is required');
  if (!script) throw new Error('script is required');

  // 1. Word-level timeline for the narration.
  const timeline = await getWordTimeline({ audioUrl: audioUrl || videoUrl, script, language, words, ...(deps.asr || {}) });
  logger(`timeline: ${timeline.words.length} words from ${timeline.provider}, ${timeline.duration.toFixed(1)}s`);

  // 2. Screen-ready subtitle chunks with per-character timing.
  const chunked = buildChunks({ script, words: timeline.words, totalDuration: timeline.duration, ...chunking });
  logger(`chunks: ${chunked.chunks.length} lines, alignment coverage ${(chunked.coverage * 100).toFixed(0)}%`);
  if (chunked.coverage < 0.6) {
    logger('warning: alignment coverage is low; check that the script matches the narration');
  }

  // 3. Layout from the (fixed) digital human position.
  const layout = createLayout({ canvas, person, face });

  // 4. AI Director decides the packaging.
  const directed = await createEditingPlan({
    llm,
    chunks: chunked.chunks,
    script,
    brief,
    duration: timeline.duration,
    layout,
    catalog,
    logger
  });
  for (const warning of directed.lintWarnings) logger(`lint: ${warning}`);

  // 5. Compile into VectCut operations.
  const ops = compilePlan({
    plan: directed.plan,
    chunks: chunked.chunks,
    layout,
    inputs: { videoUrl, audioUrl, replaceAudio, bgmUrl, bgmVolumeDb, name, duration: timeline.duration }
  });
  logger(`compiled: ${summarizeOps(ops)}`);

  // 6. Execute (or dry-run).
  const execution = await executeOps(ops, { client: vectcut, imageProvider, dryRun, logger, canvas: layout.canvas });
  for (const warning of execution.warnings || []) logger(`execute: ${warning}`);

  // 7. Optional cloud render.
  let renderResult = null;
  if (render && !dryRun) {
    const submitted = await vectcut.generateVideo({ draftId: execution.draftId, ...renderOptions });
    logger(`render submitted: ${submitted.task_id}`);
    renderResult = await vectcut.waitRender(submitted.task_id, {
      onProgress: status => logger(`render ${status.status} ${status.progress ?? ''}`)
    });
  }

  return {
    timeline: { provider: timeline.provider, duration: timeline.duration, wordCount: timeline.words.length, coverage: chunked.coverage },
    chunks: chunked.chunks,
    layout: { canvas: layout.canvas, person: layout.person, face: layout.face, freeSide: layout.freeSide },
    plan: directed.plan,
    lintWarnings: directed.lintWarnings,
    llmAttempts: directed.attempts,
    ops,
    draft: { id: execution.draftId, url: execution.draftUrl, verification: execution.verification },
    assets: execution.assets || [],
    executionWarnings: execution.warnings || [],
    render: renderResult
  };
}
