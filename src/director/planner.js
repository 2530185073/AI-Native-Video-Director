import { CATALOG } from './catalog.js';
import { lintPlan } from './lint.js';
import { buildDirectorUserPrompt, buildRepairPrompt, DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
import { buildPlanSchema, validatePlan } from './schema.js';

/**
 * Make sure every chunk has an entry (the model sometimes skips quiet lines) and
 * coerce a few values the model habitually gets slightly wrong.
 */
export function normalizePlan(plan, chunks) {
  const byId = new Map((plan.chunks || []).map(entry => [entry.id, entry]));
  plan.chunks = chunks.map(chunk => {
    const entry = byId.get(chunk.id) || { id: chunk.id, highlights: [] };
    return { id: chunk.id, highlights: Array.isArray(entry.highlights) ? entry.highlights : [], hide: Boolean(entry.hide) };
  });
  plan.beats = (plan.beats || []).map(beat => {
    const copy = { ...beat };
    if (copy.type === 'punch' && copy.chunkId == null && copy.fromChunk != null) copy.chunkId = copy.fromChunk;
    if (copy.type !== 'punch' && copy.fromChunk == null && copy.chunkId != null) copy.fromChunk = copy.chunkId;
    if (copy.type !== 'punch' && copy.toChunk == null && copy.fromChunk != null) copy.toChunk = copy.fromChunk;
    if (copy.type === 'punch' && copy.text) copy.text = String(copy.text).trim().slice(0, 14);
    if (copy.type === 'punch' && copy.flowerId === undefined) copy.flowerId = null;
    if (copy.type === 'punch' && !copy.flowerId && !copy.color) copy.color = plan.subtitleStyle?.highlightColor || '#FFE14D';
    return copy;
  });
  if (plan.subtitleStyle && plan.subtitleStyle.bold === undefined) plan.subtitleStyle.bold = true;
  if (typeof plan.bgm === 'string') plan.bgm = { track: plan.bgm, reason: '模型直接给出曲目' };
  if (plan.bgm == null) plan.bgm = { track: 'none', reason: '模型未选择音乐' };
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
  catalog = CATALOG,
  maxAttempts = 3,
  temperature,
  logger = () => {}
}) {
  if (!llm) throw new Error('an LLM provider is required');
  if (!chunks?.length) throw new Error('chunks are required');
  const schema = buildPlanSchema(catalog);
  const userPrompt = buildDirectorUserPrompt({ script, chunks, brief, duration, layout, catalog, schema });

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
    const plan = normalizePlan(structuredClone(data), chunks);
    const errors = validatePlan(plan, { chunks, catalog });
    if (!errors.length) {
      const linted = lintPlan(plan, { chunks, layout, duration });
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
