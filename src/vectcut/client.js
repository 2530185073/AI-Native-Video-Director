export const VECTCUT_BASE_URL = 'https://open.vectcut.com';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class VectCutError extends Error {
  constructor(message, { endpoint, status, body } = {}) {
    super(message);
    this.name = 'VectCutError';
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin, well-typed wrapper over the VectCut (流光剪辑) open API.
 *
 * Every method maps 1:1 to a documented endpoint (https://docs.vectcut.com/llms.txt)
 * and returns the `output` payload, throwing `VectCutError` when the service
 * reports `success: false`. Async "AI 技能广场" tasks expose `wait*` helpers.
 */
export class VectCutClient {
  constructor({
    apiKey = process.env.VECTCUT_API_KEY,
    baseUrl = process.env.VECTCUT_BASE_URL || VECTCUT_BASE_URL,
    timeoutMs = 120000,
    retries = 2,
    fetchImpl = fetch,
    logger = () => {}
  } = {}) {
    if (!apiKey) throw new Error('VECTCUT_API_KEY is required');
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async request(method, path, { body, query } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        if (response.status >= 500 && attempt < this.retries) {
          lastError = new VectCutError(`VectCut ${path} HTTP ${response.status}`, { endpoint: path, status: response.status, body: data });
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          throw new VectCutError(`VectCut ${path} HTTP ${response.status}: ${(data?.error || text || '').toString().slice(0, 400)}`, { endpoint: path, status: response.status, body: data });
        }
        if (data && data.success === false) {
          throw new VectCutError(`VectCut ${path} failed: ${data.error || JSON.stringify(data).slice(0, 400)}`, { endpoint: path, status: response.status, body: data });
        }
        this.logger(`${method} ${path} ok`);
        return data;
      } catch (error) {
        if (error instanceof VectCutError) throw error;
        lastError = error;
        if (attempt >= this.retries) break;
        await sleep(800 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new VectCutError(`VectCut ${path} failed`, { endpoint: path });
  }

  post(path, body) { return this.request('POST', path, { body }); }
  get(path, query) { return this.request('GET', path, { query }); }

  // ---- draft ---------------------------------------------------------------

  async createDraft({ width = 1080, height = 1920, name, cover } = {}) {
    const data = await this.post('/cut_jianying/create_draft', { width, height, name, cover });
    return data.output;
  }

  async queryScript(draftId) {
    const data = await this.post('/cut_jianying/query_script', { draft_id: draftId, force_update: true });
    const output = data.output;
    return typeof output === 'string' ? JSON.parse(output) : output;
  }

  // ---- media ---------------------------------------------------------------

  async addVideo(params) {
    const data = await this.post('/cut_jianying/add_video', params);
    return data.output;
  }

  async addAudio(params) {
    const data = await this.post('/cut_jianying/add_audio', params);
    return data.output;
  }

  async addImage(params) {
    const data = await this.post('/cut_jianying/add_image', params);
    return data.output;
  }

  async addVideoKeyframe(params) {
    const data = await this.post('/cut_jianying/add_video_keyframe', params);
    return data.output;
  }

  async addEffect(params) {
    const data = await this.post('/cut_jianying/add_effect', params);
    return data.output;
  }

  // ---- text ----------------------------------------------------------------

  async addText(params) {
    const data = await this.post('/cut_jianying/add_text', params);
    return data.output;
  }

  async addBatchText(params) {
    const data = await this.post('/cut_jianying/add_batch_text', params);
    return data.output;
  }

  async addSubtitle(params) {
    const data = await this.post('/cut_jianying/add_subtitle', params);
    return data.output;
  }

  async addTextTemplate(params) {
    const data = await this.post('/cut_jianying/add_text_template', params);
    return data.output;
  }

  async searchArtist(keyword, offset = 0) {
    return this.get('/cut_jianying/artist/search_artist', { keyword, offset });
  }

  // ---- capability lookups --------------------------------------------------

  async listTypes(kind) {
    const paths = {
      textIntro: '/cut_jianying/get_text_intro_types',
      textOutro: '/cut_jianying/get_text_outro_types',
      textLoop: '/cut_jianying/get_text_loop_anim_types',
      fonts: '/cut_jianying/get_font_types',
      imageIntro: '/cut_jianying/get_intro_animation_types',
      imageOutro: '/cut_jianying/get_outro_animation_types',
      imageCombo: '/cut_jianying/get_combo_animation_types',
      transitions: '/cut_jianying/get_transition_types',
      masks: '/cut_jianying/get_mask_types',
      sceneEffects: '/cut_jianying/get_video_scene_effect_types',
      characterEffects: '/cut_jianying/get_video_character_effect_types'
    };
    if (!paths[kind]) throw new Error(`unknown type list: ${kind}`);
    const data = await this.get(paths[kind]);
    return data.output;
  }

  // ---- media info ----------------------------------------------------------

  async getDuration(url) {
    const data = await this.post('/cut_jianying/get_duration', { url, video_url: url, audio_url: url });
    return data.output;
  }

  async getResolution(url) {
    const data = await this.post('/cut_jianying/get_resolution', { url, video_url: url, image_url: url });
    return data.output;
  }

  // ---- AI image generation (aggregator) ------------------------------------

  async submitImageTask(params) {
    return this.post('/llm/image/submit_task/generate', params);
  }

  async imageTaskStatus(taskId) {
    return this.get('/llm/image/submit_task/task_status', { task_id: taskId });
  }

  async waitImageTask(taskId, { intervalMs = 3000, timeoutMs = 300000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const status = await this.imageTaskStatus(taskId);
      const state = String(status.status || '').toLowerCase();
      if (state === 'success' || status.success === true && status.result?.image) return status;
      if (state === 'failure' || state === 'failed' || state === 'error' || status.result?.error) {
        throw new VectCutError(`image task ${taskId} failed: ${status.result?.error || status.error || status.message}`, { endpoint: 'image task', body: status });
      }
      await sleep(intervalMs);
    }
    throw new VectCutError(`image task ${taskId} timed out`, { endpoint: 'image task' });
  }

  // ---- temporary uploads ---------------------------------------------------

  async uploadTemporaryFile({ fileName, bytes, contentType }) {
    const init = await this.post('/sts/upload/agent_tmp/init', { file_name: fileName });
    const form = new FormData();
    for (const [key, value] of Object.entries(init.upload.form_data || {})) form.append(key, String(value));
    form.append('file', new Blob([bytes], { type: contentType || 'application/octet-stream' }), init.file_name);
    const response = await this.fetchImpl(init.upload.upload_url, { method: init.upload.method || 'POST', body: form });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new VectCutError(`temporary upload failed: HTTP ${response.status} ${text.slice(0, 200)}`, { endpoint: 'oss upload', status: response.status });
    }
    return { url: init.download.signed_url, expiresAt: init.download.expire_at, objectKey: init.object_key };
  }

  // ---- cloud render --------------------------------------------------------

  async generateVideo({ draftId, resolution = '1080P', framerate = '30', idle = false } = {}) {
    const path = idle ? '/cut_jianying/generate_idle_video' : '/cut_jianying/generate_video';
    const data = await this.post(path, { draft_id: draftId, resolution, framerate });
    return data.output;
  }

  async renderTaskStatus(taskId) {
    const data = await this.post('/cut_jianying/task_status', { task_id: taskId });
    return data.output;
  }

  async waitRender(taskId, { intervalMs = 8000, timeoutMs = 45 * 60000, onProgress = () => {} } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const status = await this.renderTaskStatus(taskId);
      onProgress(status);
      if (status.status === 'SUCCESS') return status;
      if (status.status === 'FAILURE') throw new VectCutError(`render ${taskId} failed: ${status.error || status.message}`, { endpoint: 'render', body: status });
      await sleep(intervalMs);
    }
    throw new VectCutError(`render ${taskId} timed out`, { endpoint: 'render' });
  }
}

export function createVectCutClient(options) {
  return new VectCutClient(options);
}
