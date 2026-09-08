import { buildChunks } from '../../src/timeline/chunker.js';
import { createLayout } from '../../src/layout/layout.js';

export const SCRIPT = '很多人问我，一万块钱左右能不能买到真银元？答案是可以，但要注意三个点。第一，看重量，标准的袁大头是26.8克。第二，听声音。第三，一定要找靠谱的渠道，不然很容易吃亏！';

/** Synthetic TTS-like timeline: 0.22s per character, 0.45s pause at punctuation. */
export function syntheticWords(script = SCRIPT, { perChar = 0.22, pause = 0.45, offset = 0.3 } = {}) {
  let time = offset;
  const words = [];
  for (const char of script) {
    if ('，。？！、；：'.includes(char)) { time += pause; continue; }
    words.push({ word: char, start: Number(time.toFixed(3)), end: Number((time + 0.2).toFixed(3)) });
    time += perChar;
  }
  return { words, duration: Number((time + 0.5).toFixed(3)) };
}

export function fixture() {
  const { words, duration } = syntheticWords();
  const chunked = buildChunks({ script: SCRIPT, words, totalDuration: duration });
  const layout = createLayout({});
  return { script: SCRIPT, words, duration, chunks: chunked.chunks, layout };
}

export function samplePlan(chunks) {
  return {
    concept: '知识类口播：白字黑边+黄色高亮，克制推镜，商品段落用全屏图',
    tone: 'authoritative',
    bgm: { track: 'lofi_clean', reason: '知识类内容，干净的 Lo-Fi 不抢戏' },
    subtitleStyle: {
      font: '新青年体',
      fontSize: 13,
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 40,
      strokeOpacity: 40,
      highlightColor: '#FFE14D',
      highlightScale: 1.25,
      position: 'lower_third',
      transformY: -0.4,
      intro: null,
      bold: true,
      background: { enabled: false }
    },
    chunks: chunks.map(chunk => ({
      id: chunk.id,
      highlights: chunk.text.includes('一万') ? ['一万'] : chunk.text.includes('26.8') ? ['26.8克'] : [],
      hide: false
    })),
    beats: [
      { type: 'punch', chunkId: 2, text: '一万块', flowerId: 'W0BpSlRRRldCZlhQTFpAaERcUw==', fontSize: 20, intro: '弹入', loop: '轻微跳动', position: 'above_head', outro: null, sfx: 'ding', reason: '价格是 hook' },
      { type: 'zoom', fromChunk: 3, toChunk: 4, scale: 1.12, reason: '结论句强调' },
      { type: 'broll', fromChunk: 7, toChunk: 7, prompt: '一枚民国袁大头银元放在电子秤上，特写，柔和侧光，写实摄影', layout: 'fullscreen', imageIntro: '渐显', outro: '缩小', sfx: 'whoosh', reason: '讲到具体重量，需要看到实物' },
      { type: 'effect', fromChunk: 12, toChunk: 12, name: '色差故障', reason: '结尾反转' }
    ]
  };
}

/** LLM stub that returns a scripted sequence of JSON payloads. */
export function mockLLM(payloads) {
  const queue = [...payloads];
  const calls = [];
  return {
    calls,
    async generateJson({ user }) {
      calls.push(user);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { data: structuredClone(next), mode: 'mock' };
    }
  };
}

/** VectCut client stub that records every call. */
export function mockVectCut({ failBatchText = false, failEffect = false } = {}) {
  const calls = [];
  const record = (name, params) => { calls.push({ name, params }); return { draft_id: 'dfd_test', draft_url: 'https://vectcut.test/draft/dfd_test' }; };
  return {
    calls,
    createDraft: async params => record('create_draft', params),
    addVideo: async params => record('add_video', params),
    addAudio: async params => record('add_audio', params),
    addImage: async params => record('add_image', params),
    addText: async params => record('add_text', params),
    addBatchText: async params => {
      if (failBatchText) throw new Error('batch not supported');
      return record('add_batch_text', params);
    },
    addVideoKeyframe: async params => record('add_video_keyframe', params),
    addEffect: async params => {
      if (failEffect) throw new Error('effect unsupported');
      return record('add_effect', params);
    },
    queryScript: async () => ({ duration: 21_820_000, fps: 30, canvas_config: { width: 1080, height: 1920 }, tracks: [{ name: 'video_main', type: 'video', segments: [{}] }, { name: 'subtitle', type: 'text', segments: [{}, {}] }], materials: { texts: [{}, {}], videos: [{ type: 'video' }], video_effects: [] } }),
    getDuration: async url => { calls.push({ name: 'get_duration', params: { url } }); return { duration: 9.5, video_url: url }; },
    submitAsrTask: async params => { calls.push({ name: 'submit_asr', params }); return { task_id: 'asr_1', status: 'pending' }; },
    asrTaskStatus: async taskId => {
      calls.push({ name: 'asr_status', params: { taskId } });
      return { status: 'success', result: { mode: 'sta', content: '要想在浦东', segments: [{ start: 0, end: 734, text: '要想在浦东', words: [{ text: '要', start_time: 0, end_time: 100 }, { text: '想', start_time: 100, end_time: 240 }, { text: '在', start_time: 240, end_time: 400 }, { text: '浦', start_time: 400, end_time: 560 }, { text: '东', start_time: 560, end_time: 734 }] }] } };
    },
    generateVideo: async () => ({ task_id: 'task_1' }),
    waitRender: async () => ({ status: 'SUCCESS', result: 'https://vectcut.test/out.mp4' })
  };
}

export function mockImageProvider() {
  const calls = [];
  return {
    calls,
    async generate({ prompt, aspect }) {
      calls.push({ prompt, aspect });
      const size = aspect === '9:16' ? { width: 768, height: 1376 } : aspect === '16:9' ? { width: 1376, height: 768 } : { width: 1024, height: 1024 };
      return { url: `https://img.test/${calls.length}.png`, ...size, provider: 'mock', model: 'mock' };
    }
  };
}
