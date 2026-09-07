import { extractJson } from './openai-compatible.js';

export const GEMINI_NATIVE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const TYPE_MAP = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN'
};

/** Keys Gemini's responseSchema accepts. Everything else (pattern, min/max, additionalProperties…) is stripped. */
const GEMINI_SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'items', 'enum', 'nullable', 'description', 'format']);

/**
 * Turn an OpenAI-compatible /v1 base into the Gemini v1beta root.
 *   https://api.example/v1            → https://api.example/v1beta
 *   https://…/v1beta/openai           → https://…/v1beta
 *   https://…/v1beta                  → unchanged
 */
export function resolveGeminiBaseUrl(url = process.env.GEMINI_BASE_URL || process.env.LLM_BASE_URL) {
  if (!url) return GEMINI_NATIVE_BASE_URL;
  let value = String(url).replace(/\/+$/, '');
  value = value.replace(/\/openai$/, '');
  if (/\/v1$/i.test(value)) value = value.replace(/\/v1$/i, '/v1beta');
  return value;
}

/**
 * Convert a JSON Schema (used by the director locally) into Gemini's Schema proto
 * shape: uppercase types, nullability via `nullable`, no type unions.
 */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  let type = schema.type;
  let nullable = Boolean(schema.nullable);
  if (Array.isArray(type)) {
    if (type.includes('null')) nullable = true;
    type = type.find(entry => entry !== 'null') || 'string';
  }

  const output = {};
  if (type) output.type = TYPE_MAP[type] || String(type).toUpperCase();
  if (nullable) output.nullable = true;

  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key) || key === 'type' || key === 'nullable') continue;
    if (key === 'enum') {
      output.enum = value.filter(option => option !== null);
      continue;
    }
    if (key === 'properties') {
      output.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, toGeminiSchema(child)])
      );
      continue;
    }
    if (key === 'items') {
      output.items = toGeminiSchema(value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function authHeaders(apiKey) {
  // Official Google keys are AIza… and prefer x-goog-api-key; gateways (sk-…) use Bearer.
  if (/^AIza/i.test(apiKey) || process.env.GEMINI_AUTH === 'api-key') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const texts = parts.map(part => part?.text).filter(value => typeof value === 'string');
  return texts.length ? texts.join('') : null;
}

function finishReason(data) {
  return data?.candidates?.[0]?.finishReason || null;
}

/**
 * Gemini native `models/{model}:generateContent` client.
 * Same `generateJson({ system, user, schema })` surface as the OpenAI-compatible provider
 * so the director / CLI can swap without other changes.
 */
export class GeminiLLM {
  constructor({
    apiKey = process.env.LLM_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
    baseUrl = resolveGeminiBaseUrl(),
    model = process.env.LLM_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    temperature = Number(process.env.LLM_TEMPERATURE ?? 0.7),
    structuredMode = process.env.LLM_STRUCTURED_OUTPUT || 'json_schema',
    timeoutMs = 180000,
    fetchImpl = fetch
  } = {}) {
    if (!apiKey) throw new Error('LLM_API_KEY (or GOOGLE_GEMINI_API_KEY) is required');
    this.apiKey = apiKey;
    this.baseUrl = resolveGeminiBaseUrl(baseUrl);
    this.model = model;
    this.temperature = temperature;
    this.structuredMode = structuredMode;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.name = 'gemini';
  }

  get endpoint() {
    return `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
  }

  async generateContent({ system, user, generationConfig = {}, temperature = this.temperature } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: String(user ?? '') }] }],
        generationConfig: { temperature, ...generationConfig }
      };
      if (system) body.systemInstruction = { parts: [{ text: String(system) }] };

      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: authHeaders(this.apiKey),
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Gemini request failed: HTTP ${response.status} - ${text.slice(0, 500)}`);
        error.status = response.status;
        error.body = text;
        throw error;
      }
      const data = JSON.parse(text);
      const content = extractText(data);
      if (typeof content !== 'string') {
        const reason = finishReason(data);
        throw new Error(`Gemini response had no text content${reason ? ` (finishReason=${reason})` : ''}`);
      }
      return {
        content,
        raw: data,
        usage: data.usageMetadata,
        finishReason: finishReason(data)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask for JSON that matches `schema`. Tries Gemini responseSchema first, then
   * application/json without a schema, then plain text + local extraction.
   */
  async generateJson({ system, user, schema, schemaName = 'response', temperature } = {}) {
    const attempts = [];
    if (this.structuredMode === 'json_schema' && schema) {
      attempts.push({
        mode: 'json_schema',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema)
        }
      });
    }
    if (this.structuredMode !== 'none') {
      attempts.push({
        mode: 'json_object',
        generationConfig: { responseMimeType: 'application/json' }
      });
    }
    attempts.push({ mode: 'text', generationConfig: {} });

    let lastError;
    for (const attempt of attempts) {
      try {
        const result = await this.generateContent({
          system,
          user: attempt.mode === 'text'
            ? `${user}\n\n请只输出符合 ${schemaName} 的 JSON 对象，不要 markdown 代码块。`
            : user,
          generationConfig: attempt.generationConfig,
          temperature
        });
        return { data: extractJson(result.content), usage: result.usage, mode: attempt.mode, raw: result.raw };
      } catch (error) {
        lastError = error;
        // Only fall back on schema / payload rejection; surface auth/network errors immediately.
        if (!(error.status === 400 && attempt.mode !== 'text')) throw error;
      }
    }
    throw lastError;
  }
}

export function createGeminiLLM(options) {
  return new GeminiLLM(options);
}
