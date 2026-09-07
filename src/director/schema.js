import { validateSchema } from '../util/json-schema.js';
import { CATALOG, flowerIds, names } from './catalog.js';

const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const nullableString = { type: ['string', 'null'] };

/**
 * JSON Schema for the AI Director's output. The same object is sent to the LLM
 * as a structured-output schema and used locally to validate the response.
 *
 * All times are expressed through chunk ids rather than seconds: the model reasons
 * about *what is being said*, and the compiler resolves exact timestamps from the
 * ASR-aligned chunk table. This removes the most common failure mode of LLM
 * editing plans (invented or drifting timestamps).
 */
export function buildPlanSchema(catalog = CATALOG) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['concept', 'tone', 'subtitleStyle', 'chunks', 'beats'],
    properties: {
      concept: { type: 'string', minLength: 4, maxLength: 200 },
      tone: { type: 'string', enum: catalog.tones },
      subtitleStyle: {
        type: 'object',
        additionalProperties: false,
        required: ['font', 'fontSize', 'color', 'strokeColor', 'strokeWidth', 'highlightColor', 'highlightScale', 'position', 'intro'],
        properties: {
          font: { type: 'string', enum: names(catalog.fonts) },
          fontSize: { type: 'number', minimum: 6, maximum: 16 },
          color,
          strokeColor: color,
          strokeWidth: { type: 'integer', minimum: 0, maximum: 60 },
          highlightColor: color,
          highlightScale: { type: 'number', minimum: 1, maximum: 1.6 },
          position: { type: 'string', enum: names(catalog.subtitlePositions) },
          intro: { type: ['string', 'null'], enum: [...names(catalog.textIntro), null] },
          bold: { type: 'boolean' },
          background: {
            type: 'object',
            additionalProperties: false,
            required: ['enabled'],
            properties: {
              enabled: { type: 'boolean' },
              color,
              alpha: { type: 'number', minimum: 0, maximum: 1 }
            }
          }
        }
      },
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'highlights'],
          properties: {
            id: { type: 'integer', minimum: 1 },
            highlights: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 12 }, maxItems: 3 },
            hide: { type: 'boolean' }
          }
        }
      },
      beats: {
        type: 'array',
        maxItems: 80,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'reason'],
          properties: {
            type: { type: 'string', enum: ['punch', 'zoom', 'broll', 'effect'] },
            reason: { type: 'string', minLength: 2, maxLength: 120 },
            chunkId: { type: 'integer', minimum: 1 },
            fromChunk: { type: 'integer', minimum: 1 },
            toChunk: { type: 'integer', minimum: 1 },
            text: { type: 'string', minLength: 1, maxLength: 14 },
            flowerId: { type: ['string', 'null'], enum: [...flowerIds(), null] },
            color: { ...color, type: ['string', 'null'] },
            fontSize: { type: 'number', minimum: 10, maximum: 30 },
            intro: { type: ['string', 'null'], enum: [...names(catalog.textIntro), null] },
            outro: { type: ['string', 'null'], enum: [...names(catalog.textOutro), ...names(catalog.imageOutro), null] },
            loop: { type: ['string', 'null'], enum: [...names(catalog.textLoop), null] },
            position: { type: ['string', 'null'], enum: [...names(catalog.punchPositions), null] },
            scale: { type: 'number', minimum: 1.03, maximum: 1.35 },
            prompt: { type: 'string', minLength: 6, maxLength: 400 },
            layout: { type: ['string', 'null'], enum: [...names(catalog.brollLayouts), null] },
            imageIntro: { type: ['string', 'null'], enum: [...names(catalog.imageIntro), null] },
            name: { type: ['string', 'null'], enum: [...names(catalog.sceneEffects), null] }
          }
        }
      }
    }
  };
}

const BEAT_RULES = {
  punch: { required: ['chunkId', 'text'] },
  zoom: { required: ['fromChunk', 'toChunk', 'scale'] },
  broll: { required: ['fromChunk', 'toChunk', 'prompt', 'layout'] },
  effect: { required: ['fromChunk', 'toChunk', 'name'] }
};

/**
 * Full validation: JSON-schema shape plus the per-beat conditional requirements
 * and chunk-id references that a flat schema cannot express.
 */
export function validatePlan(plan, { chunks, catalog = CATALOG } = {}) {
  const errors = validateSchema(plan, buildPlanSchema(catalog));
  if (errors.length) return errors;

  const chunkIds = new Set((chunks || []).map(chunk => chunk.id));
  const knownChunk = id => !chunks || chunkIds.has(id);

  plan.chunks.forEach((entry, index) => {
    if (!knownChunk(entry.id)) errors.push(`$.chunks[${index}].id: unknown chunk ${entry.id}`);
  });

  plan.beats.forEach((beat, index) => {
    const rule = BEAT_RULES[beat.type];
    for (const key of rule.required) {
      if (beat[key] === undefined || beat[key] === null) errors.push(`$.beats[${index}].${key}: required for type "${beat.type}"`);
    }
    for (const key of ['chunkId', 'fromChunk', 'toChunk']) {
      if (beat[key] !== undefined && beat[key] !== null && !knownChunk(beat[key])) errors.push(`$.beats[${index}].${key}: unknown chunk ${beat[key]}`);
    }
    if (beat.fromChunk != null && beat.toChunk != null && beat.toChunk < beat.fromChunk) {
      errors.push(`$.beats[${index}]: toChunk must be >= fromChunk`);
    }
  });
  return errors;
}
