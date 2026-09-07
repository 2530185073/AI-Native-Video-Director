import { segmentsToSrt } from './subtitles.js';

export const DEFAULT_GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const DEFAULT_GROQ_WHISPER_MODEL = 'whisper-large-v3';

function resolveEndpoint(baseUrl) {
  const value = String(baseUrl || DEFAULT_GROQ_WHISPER_URL).replace(/\/+$/, '');
  if (value.endsWith('/audio/transcriptions')) return value;
  if (value.endsWith('/v1')) return `${value}/audio/transcriptions`;
  if (value.endsWith('/openai')) return `${value}/v1/audio/transcriptions`;
  return `${value}/v1/audio/transcriptions`;
}

function filenameFromUrl(audioUrl) {
  try {
    const pathname = new URL(audioUrl).pathname;
    const filename = decodeURIComponent(pathname.split('/').pop() || 'audio.mp3');
    return filename || 'audio.mp3';
  } catch {
    return 'audio.mp3';
  }
}

function durationFromResponse(data) {
  const direct = Number(data?.duration);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const candidates = [
    ...(Array.isArray(data?.segments) ? data.segments : []),
    ...(Array.isArray(data?.words) ? data.words : [])
  ];
  return candidates.reduce((max, item) => Math.max(max, Number(item?.end ?? item?.start ?? 0) || 0), 0) || null;
}

export function responseToSrt(data) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data?.segments) && data.segments.length) return segmentsToSrt(data.segments);
  if (Array.isArray(data?.words) && data.words.length) {
    return segmentsToSrt(data.words.map(word => ({ start: word.start, end: word.end, text: word.word })));
  }
  return String(data?.text || data || '');
}

export async function transcribeWithGroq({
  audioUrl,
  apiKey = process.env.GROQ_API_KEY,
  baseUrl = process.env.GROQ_WHISPER_URL || DEFAULT_GROQ_WHISPER_URL,
  model = process.env.GROQ_WHISPER_MODEL || DEFAULT_GROQ_WHISPER_MODEL,
  language = 'zh',
  prompt,
  signal,
  timeoutMs = 600000
} = {}) {
  if (!audioUrl) throw new Error('audioUrl is required');
  if (!apiKey) throw new Error('GROQ_API_KEY is required');

  const controller = signal ? null : new AbortController();
  const requestSignal = signal || controller.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const audioResponse = await fetch(audioUrl, { signal: requestSignal });
    if (!audioResponse.ok) throw new Error(`audio download failed: HTTP ${audioResponse.status}`);
    const audioBuffer = await audioResponse.arrayBuffer();
    const form = new FormData();
    form.append('file', new Blob([audioBuffer]), filenameFromUrl(audioUrl));
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('language', language);
    form.append('timestamp_granularities[]', 'word');
    if (prompt) form.append('prompt', String(prompt));

    const response = await fetch(resolveEndpoint(baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: requestSignal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Whisper request failed: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 300)}` : ''}`);
    }
    const data = await response.json();
    return {
      raw: data,
      srt: responseToSrt(data),
      words: Array.isArray(data?.words) ? data.words : [],
      segments: Array.isArray(data?.segments) ? data.segments : [],
      duration: durationFromResponse(data)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
