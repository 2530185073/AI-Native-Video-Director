import { CATALOG, DEFAULT_SUBTITLE_STYLE, names } from './catalog.js';
import { lintPlan } from './lint.js';
import { buildDirectorUserPrompt, buildRepairPrompt, DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
import { buildPlanSchema, validatePlan } from './schema.js';
import { DEFAULT_BGM_TRACK } from './audio.js';

/**
 * Make sure every chunk has an entry (the model sometimes skips quiet lines) and
 * coerce a few values the model habitually gets slightly wrong — especially under
 * Gemini native responseSchema, which often omits fields that are optional in the
 * flat schema but required for a given beat type (scale / prompt / layout / name).
 */
export function normalizePlan(plan, chunks, catalog = CATALOG) {
  const chunkIds = (chunks || []).map(chunk => chunk.id);
  const known = new Set(chunkIds);
  const firstId = chunkIds[0] ?? 1;
  const lastId = chunkIds.at(-1) ?? firstId;
  const effectNames = names(catalog.sceneEffects);
  const layoutNames = names(catalog.brollLayouts);

  const coerceChunkId = (value, fallback = firstId) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const id = Math.round(number);
    if (known.has(id)) return id;
    // Wild Gemini integers (e.g. 3.48e+99) → nearest in-range id.
    if (id < firstId) return firstId;
    if (id > lastId) return lastId;
    return chunkIds.reduce((best, candidate) => (
      Math.abs(candidate - id) < Math.abs(best - id) ? candidate : best
    ), firstId);
  };

  const byId = new Map((plan.chunks || []).map(entry => [entry.id, entry]));
  plan.chunks = chunks.map(chunk => {
    const entry = byId.get(chunk.id) || { id: chunk.id, highlights: [] };
    return { id: chunk.id, highlights: Array.isArray(entry.highlights) ? entry.highlights : [], hide: Boolean(entry.hide) };
  });

  plan.beats = (plan.beats || []).flatMap(beat => {
    const copy = { ...beat };
    if (copy.type === 'punch' && copy.chunkId == null && copy.fromChunk != null) copy.chunkId = copy.fromChunk;
    if (copy.type !== 'punch' && copy.fromChunk == null && copy.chunkId != null) copy.fromChunk = copy.chunkId;
    if (copy.type !== 'punch' && copy.toChunk == null && copy.fromChunk != null) copy.toChunk = copy.fromChunk;

    for (const key of ['chunkId', 'fromChunk', 'toChunk']) {
      if (copy[key] != null) copy[key] = coerceChunkId(copy[key], copy.fromChunk ?? copy.chunkId ?? firstId);
    }
    if (copy.fromChunk != null && copy.toChunk != null && copy.toChunk < copy.fromChunk) copy.toChunk = copy.fromChunk;

    if (copy.type === 'punch') {
      if (copy.text) copy.text = String(copy.text).trim().slice(0, 14);
      if (!copy.text) return [];
      if (copy.flowerId === undefined) copy.flowerId = null;
      if (!copy.flowerId && !copy.color) copy.color = plan.subtitleStyle?.highlightColor || '#FFE14D';
      if (!copy.position) copy.position = 'above_head';
    }

    if (copy.type === 'zoom') {
      const scale = Number(copy.scale);
      copy.scale = Number.isFinite(scale) ? Math.min(1.35, Math.max(1.03, scale)) : 1.12;
      if (copy.fromChunk == null) return [];
    }

    if (copy.type === 'broll') {
      if (!copy.layout || !layoutNames.includes(copy.layout)) {
        const hint = `${copy.reason || ''} ${copy.prompt || ''}`;
        copy.layout = /右侧|左边|侧边|pip/i.test(hint) ? (layoutNames.includes('pip_side') ? 'pip_side' : layoutNames[0])
          : /全屏|铺满/i.test(hint) ? (layoutNames.includes('fullscreen') ? 'fullscreen' : layoutNames[0])
            : (layoutNames.includes('lower_card') ? 'lower_card' : layoutNames[0]);
      }
      if (!copy.prompt || String(copy.prompt).trim().length < 6) {
        const seed = String(copy.reason || '').trim();
        if (seed.length < 4) return [];
        copy.prompt = `${seed}。写实摄影，柔和侧光，画面中不要出现任何文字、水印、logo。`;
      }
      if (copy.fromChunk == null) return [];
    }

    if (copy.type === 'effect') {
      if (!copy.name || !effectNames.includes(copy.name)) {
        const hint = String(copy.reason || '');
        copy.name = /开场|开幕|进场/.test(hint) ? effectNames.find(name => /开幕|模糊/.test(name)) || effectNames[0]
          : /结尾|收尾|结束|闭幕/.test(hint) ? effectNames.find(name => /闭幕|渐隐|淡出/.test(name)) || effectNames[0]
            : /警示|警告|避坑|故障/.test(hint) ? effectNames.find(name => /故障|色差/.test(name)) || effectNames[0]
              : effectNames.find(name => /开幕|模糊/.test(name)) || effectNames[0];
      }
      if (!copy.name || copy.fromChunk == null) return [];
    }

    return [copy];
  });

  // Exact-subtitle look is product-locked: keep the director's highlight/intro choices,
  // but always ship 新青年体 / size 13 / white / black stroke 40@40% / y=-0.4 / no black bar.
  const incoming = plan.subtitleStyle && typeof plan.subtitleStyle === 'object' ? plan.subtitleStyle : {};
  plan.subtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    highlightColor: incoming.highlightColor || DEFAULT_SUBTITLE_STYLE.highlightColor,
    highlightScale: incoming.highlightScale || DEFAULT_SUBTITLE_STYLE.highlightScale,
    intro: incoming.intro === undefined ? DEFAULT_SUBTITLE_STYLE.intro : incoming.intro,
    background: { enabled: false },
    font: DEFAULT_SUBTITLE_STYLE.font,
    fontSize: DEFAULT_SUBTITLE_STYLE.fontSize,
    color: DEFAULT_SUBTITLE_STYLE.color,
    strokeColor: DEFAULT_SUBTITLE_STYLE.strokeColor,
    strokeWidth: DEFAULT_SUBTITLE_STYLE.strokeWidth,
    strokeOpacity: DEFAULT_SUBTITLE_STYLE.strokeOpacity,
    position: DEFAULT_SUBTITLE_STYLE.position,
    transformY: DEFAULT_SUBTITLE_STYLE.transformY,
    bold: true
  };
  // Big punch words sit at the top of the frame so they never stack on the subtitle line.
  for (const beat of plan.beats || []) {
    if (beat.type === 'punch' && (!beat.position || beat.position === 'chest' || beat.position === 'above_head')) {
      beat.position = beat.position === 'above_head' ? 'above_head' : 'top';
    }
  }
  if (typeof plan.bgm === 'string') plan.bgm = { track: plan.bgm, reason: '模型直接给出曲目' };
  if (plan.bgm == null || plan.bgm.track == null) {
    plan.bgm = { track: DEFAULT_BGM_TRACK, reason: '未选择时使用默认通用口播垫乐' };
  }
  // talk_default is the product default pad; keep soft_pad / none when the model intends them.
  if (plan.bgm.track === 'lofi_clean') {
    plan.bgm = { track: DEFAULT_BGM_TRACK, reason: `${plan.bgm.reason || '改用默认通用口播垫乐'}`.trim() };
  }
  if (plan.tone && !catalog.tones.includes(plan.tone)) plan.tone = catalog.tones[0];
  return plan;
}

/**
 * Run the AI Director: prompt → structured plan → validate → (repair) → lint.
 */
export async function createEditingPlan({
  llm,
  chunks,
  script,
  brief,
  duration,
  layout,
  source,
  catalog = CATALOG,
  maxAttempts = 3,
  temperature,
  logger = () => {}
}) {
  if (!llm) throw new Error('an LLM provider is required');
  if (!chunks?.length) throw new Error('chunks are required');
  const schema = buildPlanSchema(catalog);
  const userPrompt = buildDirectorUserPrompt({ script, chunks, brief, duration, layout, source, catalog, schema });

  let user = userPrompt;
  let lastErrors = [];
  let lastData = null;
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, usage, mode } = await llm.generateJson({
      system: DIRECTOR_SYSTEM_PROMPT,
      user,
      schema,
      schemaName: 'editing_plan',
      temperature
    });
    attempts.push({ attempt, mode, usage });
    lastData = data;
    const plan = normalizePlan(structuredClone(data), chunks, catalog);
    const errors = validatePlan(plan, { chunks, catalog });
    if (!errors.length) {
      const linted = lintPlan(plan, { chunks, layout, duration, source });
      logger(`plan accepted on attempt ${attempt} with ${linted.warnings.length} lint fix(es)`);
      return { plan: linted.plan, rawPlan: plan, lintWarnings: linted.warnings, attempts };
    }
    lastErrors = errors;
    logger(`plan attempt ${attempt} failed validation: ${errors.slice(0, 5).join('; ')}`);
    user = `${userPrompt}\n\n${buildRepairPrompt(errors, data)}`;
  }

  const error = new Error(`AI Director produced an invalid plan after ${maxAttempts} attempts: ${lastErrors.slice(0, 8).join('; ')}`);
  error.errors = lastErrors;
  error.lastPlan = lastData;
  throw error;
}
