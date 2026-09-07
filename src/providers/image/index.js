/**
 * Image generation providers used for AI B-roll.
 *
 * Interface: `generate({ prompt, aspect }) -> { url, width, height, provider, model }`.
 * `aspect` is one of '1:1' | '16:9' | '9:16' | '4:3' | '3:4'.
 */

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

export function parseSize(size) {
  const match = /^(\d+)\s*[x×]\s*(\d+)/.exec(String(size || ''));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: null, height: null };
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

export function createImageProvider({ provider = process.env.IMAGE_PROVIDER || 'vectcut', client, ...options } = {}) {
  if (provider === 'none') return null;
  if (provider === 'vectcut') return new VectCutImageProvider({ client, ...options });
  if (provider === 'openai-compatible' || provider === 'gemini' || provider === 'openai') {
    return new OpenAICompatibleImageProvider({ uploader: client, ...options });
  }
  throw new Error(`unknown image provider: ${provider}`);
}
