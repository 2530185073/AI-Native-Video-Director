import { normalizeWords } from '../timeline/words.js';

/**
 * Adapter for a user-provided "script ↔ audio" alignment service.
 *
 * The service is expected to accept the audio URL and the reference script and
 * return word/character timestamps. The request body field names are configurable
 * so the adapter can match an existing endpoint without code changes; the
 * response is parsed leniently by `normalizeWords()`.
 */
export async function alignWithExternalService({
  audioUrl,
  script,
  language = 'zh',
  url = process.env.ASR_ALIGN_URL,
  apiKey = process.env.ASR_ALIGN_API_KEY,
  method = process.env.ASR_ALIGN_METHOD || 'POST',
  audioField = process.env.ASR_ALIGN_AUDIO_FIELD || 'audio_url',
  textField = process.env.ASR_ALIGN_TEXT_FIELD || 'text',
  languageField = process.env.ASR_ALIGN_LANGUAGE_FIELD || 'language',
  extraBody = {},
  timeoutMs = 600000,
  fetchImpl = fetch
} = {}) {
  if (!url) throw new Error('ASR_ALIGN_URL is required for the external alignment provider');
  if (!audioUrl) throw new Error('audioUrl is required');

  const body = { [audioField]: audioUrl, [textField]: script, [languageField]: language, ...extraBody };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(url, {
      method,
      headers,
      body: method.toUpperCase() === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`external ASR alignment failed: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 300)}` : ''}`);
    }
    const data = await response.json();
    const words = normalizeWords(data);
    if (!words.length) throw new Error('external ASR alignment returned no timed words (check response shape)');
    return { words, raw: data };
  } finally {
    clearTimeout(timer);
  }
}
