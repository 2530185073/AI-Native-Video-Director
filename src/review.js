/**
 * Post-render QC ("the reviewer"): pull the frames that matter out of the finished
 * mp4 — the hook, every beat, the middle, the ending — tile them into one contact
 * sheet, and let a vision model grade the cut against the same doctrine the director
 * was briefed with. Nothing here changes the draft; it produces evidence
 * (`contact-sheet.jpg`, `review.json`) so a human or a retry loop can act on it.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { chunkRange, phraseTiming } from './timeline/chunker.js';
import { STATIC_FILL_REASON } from './director/lint.js';

const round1 = value => Math.round(value * 10) / 10;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

/**
 * Pick the timestamps a reviewer would scrub to. Beats are sampled a little after
 * they start (intro animations take ~0.3s); the hook, the dead middle and the last
 * second are always included. Near-duplicates collapse and the list is capped so the
 * sheet stays legible.
 */
export function reviewTimestamps({ plan, chunks, duration, maxFrames = 12 }) {
  const total = duration || chunks[chunks.length - 1]?.end || 0;
  const picks = [{ time: Math.min(0.6, total / 2), label: 'hook 0.6s' }];
  for (const beat of plan.beats || []) {
    let start;
    if (beat.type === 'punch') {
      const chunk = chunks.find(entry => entry.id === beat.chunkId);
      if (!chunk) continue;
      const timing = phraseTiming(chunk, beat.text);
      start = chunk === chunks[0] ? Math.min(chunk.start, 1) : (timing.exact ? timing.start : chunk.start);
    } else {
      const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
      if (!range) continue;
      start = range.start;
    }
    const offset = beat.type === 'zoom' ? 0.9 : 0.5;
    const label = beat.type === 'punch' ? `punch「${beat.text}」`
      : beat.type === 'broll' ? `broll ${beat.layout}`
        : beat.type === 'zoom' ? `zoom ×${beat.scale}${beat.reason === STATIC_FILL_REASON ? ' (fill)' : ''}`
          : `effect ${beat.name}`;
    picks.push({ time: start + offset, label });
  }
  picks.push({ time: total / 2, label: 'middle' });
  picks.push({ time: Math.max(0, total - 1), label: 'ending' });

  const sorted = picks
    .map(pick => ({ ...pick, time: Math.min(Math.max(0.1, pick.time), Math.max(0.1, total - 0.2)) }))
    .sort((a, b) => a.time - b.time)
    .filter((pick, index, list) => index === 0 || pick.time - list[index - 1].time > 0.4);
  if (sorted.length <= maxFrames) return sorted.map(pick => ({ ...pick, time: round1(pick.time) }));
  const step = (sorted.length - 1) / (maxFrames - 1);
  const kept = [];
  for (let index = 0; index < maxFrames; index += 1) kept.push(sorted[Math.round(index * step)]);
  return kept.map(pick => ({ ...pick, time: round1(pick.time) }));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fresh render URLs on the OSS CDN occasionally refuse the first connection from
 * Node's fetch; retry with backoff, then fall back to curl when it is on PATH.
 */
export async function downloadFile(url, target, { fetchImpl = fetch, attempts = 3, curl = process.env.CURL_PATH || 'curl' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
      return target;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1500 * attempt);
    }
  }
  try {
    await run(curl, ['-sSL', '--fail', '--max-time', '600', '-o', target, url]);
    return target;
  } catch (error) {
    if (error.code !== 'ENOENT') lastError = error;
  }
  throw new Error(`download failed: ${lastError?.cause?.code || lastError?.cause?.message || lastError?.message} ${url.slice(0, 120)}`);
}

/**
 * Grab one frame per timestamp (scaled to `frameWidth`, 9:16 letterboxed) and tile
 * them into a single JPEG with the timestamp burnt in. Returns null when ffmpeg is
 * missing so callers can degrade gracefully.
 */
export async function buildContactSheet({ videoPath, times, outDir, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', frameWidth = 360, columns = 4 }) {
  if (!times.length) return null;
  const framesDir = join(outDir, 'frames');
  mkdirSync(framesDir, { recursive: true });
  const frameHeight = Math.round(frameWidth * 16 / 9);
  const frames = [];
  const fit = `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2`;
  // drawtext needs an ffmpeg built with freetype; fall back to plain frames when it is not there.
  let stamp = true;
  try {
    for (const [index, pick] of times.entries()) {
      const file = join(framesDir, `${String(index + 1).padStart(2, '0')}_${pick.time.toFixed(1)}s.jpg`);
      const grab = withStamp => run(ffmpeg, ['-v', 'error', '-y', '-ss', String(pick.time), '-i', videoPath, '-frames:v', '1',
        '-vf', withStamp ? `${fit},drawbox=x=0:y=0:w=iw:h=28:color=black@0.6:t=fill,drawtext=text='${pick.time.toFixed(1)}s':fontcolor=white:fontsize=20:x=8:y=5` : fit,
        '-q:v', '3', file]);
      if (stamp) {
        try { await grab(true); } catch (error) { if (error.code === 'ENOENT') throw error; stamp = false; await grab(false); }
      } else {
        await grab(false);
      }
      frames.push({ ...pick, file });
    }
    const sheet = join(outDir, 'contact-sheet.jpg');
    const inputs = frames.flatMap(frame => ['-i', frame.file]);
    const rows = Math.ceil(frames.length / columns);
    const concat = frames.map((_, index) => `[${index}:v]`).join('');
    await run(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${concat}concat=n=${frames.length}:v=1:a=0,tile=${Math.min(columns, frames.length)}x${rows}:padding=4:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);
    return { sheet, frames };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export const REVIEW_RUBRIC = `你是短视频审片人。下面是一条数字人口播二次精剪成片的抽帧拼图（从左到右、从上到下按时间排列，每格左上角是秒数），以及导演的包装方案摘要。请像人类审片一样只看画面，按 1-5 分打分（5 = 直接可发）：

- hook：第 1 格是否一眼看出主题（有大字/重点词，人物清晰，无全屏图盖脸）
- readability：字幕/花字是否清晰可读、没有换行溢出、没有被截断、对比度足够
- faceClearance：花字、图片、卡片是否都避开了人脸（不压眉毛、不盖嘴）
- safeZone：文字和图片是否离画面顶部 6%、底部 16%、右侧 11% 的平台 UI 遮挡区足够远
- rhythm：抽帧之间是否有足够变化但不杂乱（不是每格都有花字，也不是每格都一样）
- styleConsistency：花字颜色/字体/图片风格是否统一

再列出具体问题（引用格子的秒数），每条给一个可执行的修法（例如“3.2s 的花字下移到头顶留白”“12.0s 的图片改成 lower_card”）。输出 JSON：
{"scores":{"hook":1-5,"readability":1-5,"faceClearance":1-5,"safeZone":1-5,"rhythm":1-5,"styleConsistency":1-5},"overall":1-5,"verdict":"ship"|"fix","issues":[{"at":"秒数","problem":"…","fix":"…"}],"summary":"一句话总评"}`;

function summarizePlanForReview(plan, frames) {
  const beats = (plan.beats || []).map(beat => {
    if (beat.type === 'punch') return `punch「${beat.text}」@chunk${beat.chunkId} ${beat.position || 'above_head'}`;
    if (beat.type === 'broll') return `broll ${beat.layout} chunk${beat.fromChunk}-${beat.toChunk}`;
    if (beat.type === 'zoom') return `zoom ×${beat.scale} chunk${beat.fromChunk}-${beat.toChunk}`;
    return `effect ${beat.name} chunk${beat.fromChunk}-${beat.toChunk}`;
  });
  return [
    `方案：${plan.concept}`,
    `字幕：${plan.subtitleStyle?.font} ${plan.subtitleStyle?.fontSize} 号，高亮色 ${plan.subtitleStyle?.highlightColor}，位置 ${plan.subtitleStyle?.position}`,
    `beats：${beats.join('；')}`,
    `拼图格子（顺序 = 时间）：${frames.map((frame, index) => `#${index + 1} ${frame.time.toFixed(1)}s ${frame.label}`).join('；')}`
  ].join('\n');
}

function parseJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('review model returned no JSON');
  return JSON.parse(match[0]);
}

/**
 * Ask a vision-capable LLM (Gemini native) to grade the contact sheet. Any provider
 * exposing `generateContent({ user, parts, generationConfig })` works.
 */
export async function reviewContactSheet({ llm, sheetPath, frames, plan, brief }) {
  if (!llm || typeof llm.generateContent !== 'function') return null;
  const image = readFileSync(sheetPath).toString('base64');
  const user = [REVIEW_RUBRIC, '', summarizePlanForReview(plan, frames), brief ? `\n需求简报：${JSON.stringify(brief)}` : ''].join('\n');
  const result = await llm.generateContent({
    user,
    parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }],
    generationConfig: { responseMimeType: 'application/json' },
    temperature: 0.2
  });
  const review = parseJson(result.content);
  return { ...review, model: llm.model, usage: result.usage };
}

/**
 * Full QC pass for a rendered video: download → contact sheet → (optional) vision review.
 */
export async function reviewRender({ videoUrl, plan, chunks, duration, outDir, llm, brief, logger = () => {}, ffmpeg, fetchImpl }) {
  mkdirSync(outDir, { recursive: true });
  const videoPath = join(outDir, 'render.mp4');
  if (!existsSync(videoPath)) {
    logger('review: downloading render');
    await downloadFile(videoUrl, videoPath, { fetchImpl });
  }
  const times = reviewTimestamps({ plan, chunks, duration });
  const sheet = await buildContactSheet({ videoPath, times, outDir, ffmpeg });
  if (!sheet) {
    logger('review: ffmpeg not found, skipped');
    return { videoPath, frames: [], sheet: null, review: null };
  }
  logger(`review: contact sheet with ${sheet.frames.length} frames → ${sheet.sheet}`);
  let review = null;
  try {
    review = await reviewContactSheet({ llm, sheetPath: sheet.sheet, frames: sheet.frames, plan, brief });
    if (review) logger(`review: ${review.verdict} overall ${review.overall}/5 — ${review.summary}`);
    else logger('review: LLM has no vision entry point, sheet only');
  } catch (error) {
    logger(`review: vision review failed (${error.message}); sheet kept`);
  }
  return { videoPath, frames: sheet.frames, sheet: sheet.sheet, review };
}
