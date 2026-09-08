/**
 * Image generation providers used for AI B-roll.
 *
 * Interface: `generate({ prompt, aspect }) -> { url, width, height, provider, model }`.
 * `aspect` is one of '1:1' | '16:9' | '9:16' | '4:3' | '3:4'.
 */

import { resolveGeminiBaseUrl } from '../llm/gemini.js';

/** Resolutions VectCut's aggregator accepts, per model (from the API docs). */
const VECTCUT_SIZES = {
  'nano_banana_2': { '1:1': '1024x1024', '16:9': '1376x768', '9:16': '768x1376', '4:3': '1200x896', '3:4': '896x1200' },
  'nano_banana_pro': { '1:1': '1024x1024', '16:9': '1376x768', '9:16': '768x1376', '4:3': '1200x896', '3:4': '896x1200' },
  'nano_banana': { '1:1': '1024x1024', '16:9': '1376x768', '9:16': '768x1376', '4:3': '1200x896', '3:4': '896x1200' },
  'gpt-image-2-all': { '1:1': '1248x1248', '16:9': '1792x1008', '9:16': '1008x1792', '4:3': '1472x1104', '3:4': '1104x1472' },
  'seedream-3.0': { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '864x1152', '3:4': '1152x864' },
  'seedream-4.0': { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2304x1728', '3:4': '1728x2304' },
  'seedream-4.5': { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2304x1728', '3:4': '1728x2304' },
  'seedream-5.0': { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2304x1728', '3:4': '1728x2304' }
};

/** OpenAI-style `/images/generations` sizes (also what Gemini/Imagen compat accepts). */
const OPENAI_SIZES = { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536' };

/** Fallback pixel sizes when Gemini returns inline bytes without readable headers. */
const GEMINI_FALLBACK_SIZES = { '1:1': '1024x1024', '16:9': '1376x768', '9:16': '768x1376', '4:3': '1200x896', '3:4': '896x1200' };

export function parseSize(size) {
  const match = /^(\d+)\s*[x×]\s*(\d+)/.exec(String(size || ''));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: null, height: null };
}

/** Read width/height from PNG or JPEG bytes. Returns nulls when unrecognized. */
export function readImageDimensions(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      // SOF0 / SOF2
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function geminiAuthHeaders(apiKey) {
  // Official Google keys are AIza… and prefer x-goog-api-key; gateways (sk-…) use Bearer.
  if (/^AIza/i.test(apiKey) || process.env.GEMINI_AUTH === 'api-key') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function extensionForMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

/** Generate through VectCut's own aggregator: no upload step, image URL is directly usable in drafts. */
export class VectCutImageProvider {
  constructor({ client, model = process.env.VECTCUT_IMAGE_MODEL || 'nano_banana_2', pollIntervalMs = 3000, timeoutMs = 300000 }) {
    if (!client) throw new Error('VectCutImageProvider requires a VectCut client');
    this.client = client;
    this.model = model;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.name = 'vectcut';
  }

  sizeFor(aspect) {
    const table = VECTCUT_SIZES[this.model] || VECTCUT_SIZES['nano_banana_2'];
    return table[aspect] || table['1:1'];
  }

  async generate({ prompt, aspect = '1:1', referenceImages } = {}) {
    const size = this.sizeFor(aspect);
    const submitted = await this.client.submitImageTask({
      prompt,
      model: this.model,
      size,
      compose_draft: false,
      ...(referenceImages?.length ? { reference_images: referenceImages } : {})
    });
    const taskId = submitted.task_id;
    if (!taskId) throw new Error(`VectCut image task did not return task_id: ${JSON.stringify(submitted).slice(0, 300)}`);
    const status = await this.client.waitImageTask(taskId, { intervalMs: this.pollIntervalMs, timeoutMs: this.timeoutMs });
    const url = status.result?.image;
    if (!url) throw new Error(`VectCut image task ${taskId} finished without an image URL`);
    return { url, ...parseSize(size), provider: this.name, model: this.model, taskId };
  }
}

/**
 * Gemini native `models/{model}:generateContent` image generation.
 * Defaults to the same key / base as the LLM (`LLM_API_KEY`, `LLM_BASE_URL`).
 * Returns hostable URLs by uploading inline bytes through VectCut temp storage.
 */
export class GeminiNativeImageProvider {
  constructor({
    apiKey = process.env.IMAGE_API_KEY || process.env.LLM_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
    baseUrl = resolveGeminiBaseUrl(process.env.IMAGE_BASE_URL || process.env.LLM_BASE_URL || process.env.GEMINI_BASE_URL),
    model = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
    uploader,
    fetchImpl = fetch,
    timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || 180000)
  } = {}) {
    if (!apiKey) throw new Error('LLM_API_KEY (or IMAGE_API_KEY) is required for Gemini image generation');
    this.apiKey = apiKey;
    this.baseUrl = resolveGeminiBaseUrl(baseUrl);
    this.model = model;
    this.uploader = uploader;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = 'gemini';
  }

  endpoint() {
    return `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
  }

  async generate({ prompt, aspect = '1:1' } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // IMAGE-only is the reliable path on zyai: TEXT+IMAGE may return empty parts + a URL text.
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: aspect }
        }
      };
      const response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: geminiAuthHeaders(this.apiKey),
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Gemini image generation failed: HTTP ${response.status} - ${text.slice(0, 400)}`);
      const data = JSON.parse(text);
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts) || !parts.length) {
        throw new Error(`Gemini image generation returned no parts: ${text.slice(0, 300)}`);
      }

      const inline = parts.find(part => part?.inlineData?.data || part?.inline_data?.data);
      const inlinePayload = inline?.inlineData || inline?.inline_data;
      if (inlinePayload?.data) {
        const mime = inlinePayload.mimeType || inlinePayload.mime_type || 'image/png';
        const bytes = Buffer.from(inlinePayload.data, 'base64');
        const dims = readImageDimensions(bytes);
        const fallback = parseSize(GEMINI_FALLBACK_SIZES[aspect] || GEMINI_FALLBACK_SIZES['1:1']);
        if (!this.uploader) throw new Error('an uploader is required to host Gemini inline images (pass a VectCut client)');
        const uploaded = await this.uploader.uploadTemporaryFile({
          fileName: `broll_${Date.now()}.${extensionForMime(mime)}`,
          bytes,
          contentType: mime
        });
        return {
          url: uploaded.url,
          width: dims.width || fallback.width,
          height: dims.height || fallback.height,
          provider: this.name,
          model: this.model,
          mimeType: mime,
          expiresAt: uploaded.expiresAt
        };
      }

      // Some gateways return a hosted URL as a text part (and empty stubs). Accept that too.
      const urlPart = parts.map(part => part?.text).find(value => typeof value === 'string' && /^https?:\/\//i.test(value.trim()));
      if (urlPart) {
        const url = urlPart.trim();
        const fallback = parseSize(GEMINI_FALLBACK_SIZES[aspect] || GEMINI_FALLBACK_SIZES['1:1']);
        return { url, ...fallback, provider: this.name, model: this.model };
      }

      throw new Error(`Gemini image generation returned neither inlineData nor image URL: ${text.slice(0, 300)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Any OpenAI-compatible `/images/generations` endpoint (OpenAI, Gemini/Imagen via
 * the OpenAI compatibility layer, or a self-hosted gateway). Base64 results are
 * uploaded to VectCut temporary storage so the draft can reference them.
 */
export class OpenAICompatibleImageProvider {
  constructor({
    apiKey = process.env.IMAGE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY,
    baseUrl = process.env.IMAGE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    model = process.env.IMAGE_MODEL || 'imagen-4.0-generate-001',
    uploader,
    fetchImpl = fetch,
    timeoutMs = 180000
  } = {}) {
    if (!apiKey) throw new Error('IMAGE_API_KEY is required for the OpenAI-compatible image provider');
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = model;
    this.uploader = uploader;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = 'openai-compatible';
  }

  async generate({ prompt, aspect = '1:1' } = {}) {
    const size = OPENAI_SIZES[aspect] || OPENAI_SIZES['1:1'];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, prompt, n: 1, size, response_format: 'b64_json' }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`image generation failed: HTTP ${response.status} - ${text.slice(0, 400)}`);
      const data = JSON.parse(text);
      const item = data?.data?.[0];
      if (!item) throw new Error('image generation returned no data');
      if (item.url) return { url: item.url, ...parseSize(size), provider: this.name, model: this.model };
      if (!item.b64_json) throw new Error('image generation returned neither url nor b64_json');
      if (!this.uploader) throw new Error('an uploader is required to host base64 images (pass a VectCut client)');
      const bytes = Buffer.from(item.b64_json, 'base64');
      const uploaded = await this.uploader.uploadTemporaryFile({ fileName: `broll_${Date.now()}.png`, bytes, contentType: 'image/png' });
      return { url: uploaded.url, ...parseSize(size), provider: this.name, model: this.model, expiresAt: uploaded.expiresAt };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createImageProvider({ provider = process.env.IMAGE_PROVIDER || 'gemini', client, ...options } = {}) {
  if (provider === 'none') return null;
  if (provider === 'vectcut') return new VectCutImageProvider({ client, ...options });
  if (provider === 'gemini' || provider === 'gemini-native') {
    return new GeminiNativeImageProvider({ uploader: client, ...options });
  }
  if (provider === 'openai-compatible' || provider === 'openai') {
    return new OpenAICompatibleImageProvider({ uploader: client, ...options });
  }
  throw new Error(`unknown image provider: ${provider}`);
}
