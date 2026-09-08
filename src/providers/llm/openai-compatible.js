export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

const STRUCTURAL_KEYS = new Set(['type', 'properties', 'required', 'items', 'enum', 'nullable', 'description']);

/**
 * Gemini's OpenAI-compatible endpoint accepts a JSON-schema subset. Strip the
 * validation-only keywords (pattern, min/max, additionalProperties...) so the
 * request is never rejected; full validation happens locally afterwards.
 */
export function simplifySchema(schema) {
  if (Array.isArray(schema)) return schema.map(simplifySchema);
  if (!schema || typeof schema !== 'object') return schema;
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!STRUCTURAL_KEYS.has(key)) continue;
    if (key === 'enum') {
      // Gemini rejects null inside enum; nullability is carried by the type array.
      output.enum = value.filter(option => option !== null);
      continue;
    }
    output[key] = key === 'properties'
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, simplifySchema(child)]))
      : simplifySchema(value);
  }
  return output;
}

export function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error(`LLM did not return JSON: ${candidate.slice(0, 200)}`);
  }
}

export class OpenAICompatibleLLM {
  constructor({
    apiKey = process.env.LLM_API_KEY || process.env.GOOGLE_GEMINI_API_KEY,
    baseUrl = process.env.LLM_BASE_URL || GEMINI_OPENAI_BASE_URL,
    model = process.env.LLM_MODEL || 'gemini-2.5-pro',
    temperature = Number(process.env.LLM_TEMPERATURE ?? 0.7),
    structuredMode = process.env.LLM_STRUCTURED_OUTPUT || 'json_schema',
    timeoutMs = 180000,
    fetchImpl = fetch
  } = {}) {
    if (!apiKey) throw new Error('LLM_API_KEY (or GOOGLE_GEMINI_API_KEY) is required');
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = model;
    this.temperature = temperature;
    this.structuredMode = structuredMode;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async chat(messages, { responseFormat, temperature = this.temperature, maxTokens } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = { model: this.model, messages, temperature };
      if (responseFormat) body.response_format = responseFormat;
      if (maxTokens) body.max_tokens = maxTokens;
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`LLM request failed: HTTP ${response.status} - ${text.slice(0, 500)}`);
        error.status = response.status;
        throw error;
      }
      const data = JSON.parse(text);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('LLM response had no message content');
      return { content, raw: data, usage: data.usage };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask for JSON that matches `schema`. Tries native structured output first and
   * degrades to json_object / plain prompting if the endpoint rejects the schema.
   */
  async generateJson({ system, user, schema, schemaName = 'response', temperature } = {}) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const attempts = [];
    if (this.structuredMode === 'json_schema' && schema) {
      attempts.push({ type: 'json_schema', json_schema: { name: schemaName, schema: simplifySchema(schema), strict: false } });
    }
    if (this.structuredMode !== 'none') attempts.push({ type: 'json_object' });
    attempts.push(null);

    let lastError;
    for (const responseFormat of attempts) {
      try {
        const result = await this.chat(messages, { responseFormat, temperature });
        return { data: extractJson(result.content), usage: result.usage, mode: responseFormat?.type || 'text' };
      } catch (error) {
        lastError = error;
        // Only fall back on schema rejection; surface auth/network errors immediately.
        if (!(error.status === 400 && responseFormat)) throw error;
      }
    }
    throw lastError;
  }
}

export function createLLM(options) {
  return new OpenAICompatibleLLM(options);
}
