import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleLLM } from '../src/providers/llm/openai-compatible.js';
import { VectCutClient, VectCutError } from '../src/vectcut/client.js';
import { VectCutImageProvider, OpenAICompatibleImageProvider } from '../src/providers/image/index.js';
import { alignWithExternalService } from '../src/asr/external.js';
import { alignWithVectCut } from '../src/asr/vectcut.js';
import { getWordTimeline } from '../src/asr/timeline.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('LLM provider falls back from json_schema to json_object when the endpoint rejects the schema', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), format: body.response_format?.type });
    if (body.response_format?.type === 'json_schema') return jsonResponse(400, { error: { message: 'unsupported response_format' } });
    return jsonResponse(200, { choices: [{ message: { content: '```json\n{"ok":true}\n```' } }], usage: { total_tokens: 12 } });
  };
  const llm = new OpenAICompatibleLLM({ apiKey: 'k', baseUrl: 'https://llm.test/v1/', model: 'm', fetchImpl });
  const result = await llm.generateJson({ system: 's', user: 'u', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } });
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.mode, 'json_object');
  assert.deepEqual(requests.map(request => request.format), ['json_schema', 'json_object']);
  assert.equal(requests[0].url, 'https://llm.test/v1/chat/completions');
});

test('LLM provider surfaces auth errors immediately', async () => {
  const llm = new OpenAICompatibleLLM({ apiKey: 'bad', fetchImpl: async () => jsonResponse(401, { error: 'unauthorized' }) });
  await assert.rejects(() => llm.generateJson({ user: 'u', schema: { type: 'object' } }), /HTTP 401/);
});

test('VectCut client adds auth, unwraps output and converts business failures into errors', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/cut_jianying/create_draft')) return jsonResponse(200, { success: true, error: '', output: { draft_id: 'd1', draft_url: 'https://v/d1' } });
    if (String(url).endsWith('/cut_jianying/add_text')) return jsonResponse(200, { success: false, error: '字体不存在' });
    if (String(url).endsWith('/cut_jianying/query_script')) return jsonResponse(200, { success: true, output: JSON.stringify({ duration: 5000000, tracks: [] }) });
    return jsonResponse(500, { error: 'boom' });
  };
  const client = new VectCutClient({ apiKey: 'vk', fetchImpl, retries: 0 });
  const draft = await client.createDraft({ name: 'x' });
  assert.equal(draft.draft_id, 'd1');
  assert.equal(seen[0].auth, 'Bearer vk');
  assert.equal(seen[0].body.width, 1080);
  await assert.rejects(() => client.addText({ text: 'a', start: 0, end: 1 }), error => error instanceof VectCutError && /字体不存在/.test(error.message));
  const script = await client.queryScript('d1');
  assert.equal(script.duration, 5000000);
  await assert.rejects(() => client.addImage({ image_url: 'u', end: 1 }), /HTTP 500/);
});

test('VectCut image provider submits, polls and returns the image URL with its size', async () => {
  let polls = 0;
  const client = {
    submitImageTask: async params => { assert.equal(params.size, '1376x768'); assert.equal(params.compose_draft, false); return { success: true, task_id: 't1' }; },
    imageTaskStatus: async () => (++polls < 2 ? { status: 'processing' } : { status: 'success', success: true, result: { image: 'https://img/1.png' } }),
    waitImageTask: VectCutClient.prototype.waitImageTask
  };
  const provider = new VectCutImageProvider({ client, model: 'nano_banana_2', pollIntervalMs: 1 });
  const image = await provider.generate({ prompt: 'p', aspect: '16:9' });
  assert.deepEqual([image.url, image.width, image.height], ['https://img/1.png', 1376, 768]);
  assert.equal(polls, 2);
});

test('OpenAI-compatible image provider uploads base64 results through VectCut temp storage', async () => {
  const uploads = [];
  const uploader = { uploadTemporaryFile: async ({ fileName, bytes }) => { uploads.push({ fileName, length: bytes.length }); return { url: 'https://oss/tmp.png', expiresAt: 'later' }; } };
  const fetchImpl = async (url, init) => {
    assert.ok(String(url).endsWith('/images/generations'));
    assert.equal(JSON.parse(init.body).size, '1024x1536');
    return jsonResponse(200, { data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] });
  };
  const provider = new OpenAICompatibleImageProvider({ apiKey: 'k', baseUrl: 'https://img.test/v1', model: 'imagen', uploader, fetchImpl });
  const image = await provider.generate({ prompt: 'p', aspect: '9:16' });
  assert.equal(image.url, 'https://oss/tmp.png');
  assert.equal(uploads[0].length, 9);
  assert.ok(uploads[0].fileName.endsWith('.png'));
});

test('external ASR adapter posts configurable fields and normalises the response', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return jsonResponse(200, { result: { items: [{ token: '你', begin: 0, end: 200 }, { token: '好', begin: 200, end: 450 }] } });
  };
  const result = await alignWithExternalService({ audioUrl: 'https://a.mp3', script: '你好', url: 'https://asr.test/align', apiKey: 'ak', audioField: 'audio', textField: 'script', fetchImpl });
  assert.equal(captured.body.audio, 'https://a.mp3');
  assert.equal(captured.body.script, '你好');
  assert.equal(captured.auth, 'Bearer ak');
  assert.deepEqual(result.words, [{ text: '你', start: 0, end: 0.2 }, { text: '好', start: 0.2, end: 0.45 }]);
});

test('VectCut ASR aligns the script (sta mode), polls until success and flattens per-character words', async () => {
  const requests = [];
  let polls = 0;
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    requests.push({ path: target.pathname, query: target.search, body: init.body ? JSON.parse(init.body) : null });
    if (target.pathname.endsWith('submit_asr_llm_task')) return jsonResponse(200, { success: true, task_id: 't-1', status: 'pending' });
    polls += 1;
    if (polls === 1) return jsonResponse(200, { success: true, status: 'processing', progress: 40 });
    return jsonResponse(200, {
      success: true,
      status: 'success',
      result: {
        mode: 'sta',
        content: '要想在浦东',
        segments: [
          { start: 0, end: 734, text: '要想在浦东', words: [{ text: '要', start_time: 0, end_time: 100 }, { text: '想', start_time: 100, end_time: 240 }, { text: '在', start_time: 240, end_time: 400 }, { text: '浦', start_time: 400, end_time: 560 }, { text: '东', start_time: 560, end_time: 734 }] }
        ]
      }
    });
  };
  const client = new VectCutClient({ apiKey: 'k', fetchImpl });
  const result = await alignWithVectCut({ client, audioUrl: 'https://a.mp3', script: '要想在浦东', intervalMs: 1 });
  assert.equal(requests[0].body.content, '要想在浦东');
  assert.equal(requests[0].body.effect_mode, 'nlp');
  assert.ok(requests[1].query.includes('task_id=t-1'));
  assert.equal(result.mode, 'sta');
  assert.equal(result.words.length, 5);
  assert.deepEqual(result.words[3], { text: '浦', start: 0.4, end: 0.56 });

  // auto: Groq is preferred whenever a key exists; VectCut is only the last resort.
  const saved = { groq: process.env.GROQ_API_KEY, align: process.env.ASR_ALIGN_URL };
  delete process.env.GROQ_API_KEY;
  delete process.env.ASR_ALIGN_URL;
  try {
    const timeline = await getWordTimeline({ audioUrl: 'https://a.mp3', script: '要想在浦东', provider: 'auto', vectcut: { client, intervalMs: 1 } });
    assert.equal(timeline.provider, 'vectcut');
    assert.equal(timeline.duration, 0.734);

    const groqCalls = [];
    let hallucinate = 0;
    const groqFetch = async (url, init) => {
      const model = init.body.get('model');
      groqCalls.push({ model, prompt: init.body.get('prompt') });
      if (hallucinate > 0) {
        hallucinate -= 1;
        return new Response(JSON.stringify({ duration: 0.734, text: '相关的部分', words: [{ word: '相关的部分', start: 0, end: 0.734 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ duration: 0.734, words: [{ word: '要想在浦东', start: 0, end: 0.734 }] }), { status: 200 });
    };
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).includes('a.mp3') ? new Response(new Uint8Array([1, 2, 3])) : groqFetch(url, init));
    try {
      const viaGroq = await getWordTimeline({ audioUrl: 'https://a.mp3', script: '要想在浦东', provider: 'auto', groq: { apiKey: 'gsk_test' }, vectcut: { client } });
      assert.equal(viaGroq.provider, 'groq');
      assert.equal(viaGroq.coverage, 1);
      assert.equal(groqCalls.length, 1);
      assert.equal(groqCalls[0].prompt, null, 'full script is not used as Whisper prompt by default');

      // First answer hallucinated → retry with the other model, which succeeds.
      groqCalls.length = 0;
      hallucinate = 1;
      const retried = await getWordTimeline({ audioUrl: 'https://a.mp3', script: '要想在浦东', provider: 'groq', groq: { apiKey: 'gsk_test' } });
      assert.equal(retried.provider, 'groq');
      assert.deepEqual(groqCalls.map(call => call.model), ['whisper-large-v3', 'whisper-large-v3-turbo']);

      // Both attempts hallucinate → VectCut script alignment takes over.
      groqCalls.length = 0;
      hallucinate = 2;
      const fellBack = await getWordTimeline({ audioUrl: 'https://a.mp3', script: '要想在浦东', provider: 'auto', groq: { apiKey: 'gsk_test' }, vectcut: { client, intervalMs: 1 } });
      assert.equal(fellBack.provider, 'vectcut');
      assert.equal(groqCalls.length, 2);

      // No fallback available → best Groq attempt is returned with its low coverage.
      hallucinate = 2;
      const lowOnly = await getWordTimeline({ audioUrl: 'https://a.mp3', script: '要想在浦东', provider: 'groq', groq: { apiKey: 'gsk_test' } });
      assert.equal(lowOnly.provider, 'groq');
      assert.ok(lowOnly.coverage < 0.6);
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    if (saved.groq !== undefined) process.env.GROQ_API_KEY = saved.groq;
    if (saved.align !== undefined) process.env.ASR_ALIGN_URL = saved.align;
  }
});
