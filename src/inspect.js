/**
 * Pre-flight look at the footage ("the director watches the raw take before planning").
 *
 * One frame of the talking-head clip goes to a vision model, which returns what a human
 * editor would note in the first second: where the face and body sit, whether the area
 * the subtitles will land on is busy (printed clothing, patterned wall), the clothing
 * colours the highlight colour must contrast with, and how bright the background is.
 * The result feeds the layout (face box), the director prompt and the lint pass
 * (translucent subtitle bar). Everything degrades gracefully: no ffmpeg or no vision
 * model simply means no observations.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFile } from './review.js';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

export const INSPECT_PROMPT = `你是短视频后期的执行导演，正在看一条数字人口播原片的一帧画面（竖屏）。请只根据画面回答，输出 JSON：
{
  "face": {"x":0-1,"y":0-1,"w":0-1,"h":0-1},
  "person": {"x":0-1,"y":0-1,"w":0-1,"h":0-1},
  "lowerThirdBusy": true|false,
  "lowerThirdReason": "一句话，例如：黑色卫衣胸前有大面积白色印花字母",
  "clothingColors": ["#RRGGBB", ...],
  "backgroundBrightness": "light"|"dark"|"mixed",
  "notes": "给包装导演的一句话提醒（可为空字符串）"
}
说明：
- 坐标是画面的归一化比例，原点在左上角；face 框从发际线到下巴、两侧到耳朵；person 框是整个可见的身体（含头发和肩膀），底边通常到画面底部。
- lowerThirdBusy：字幕会放在画面高度 62%-80% 的横带上。如果这条横带里有衣服印花/文字/图案、明暗差很大的背景或杂物，就为 true；纯色衣服和干净墙面为 false。
- clothingColors 最多 3 个，按面积从大到小；backgroundBrightness 只看人物身后的背景。
只输出 JSON。`;

function parseJson(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

const clamp01 = value => Math.min(1, Math.max(0, Number(value)));

function normalizeBox(box) {
  if (!box || typeof box !== 'object') return null;
  const result = { x: clamp01(box.x), y: clamp01(box.y), w: clamp01(box.w), h: clamp01(box.h) };
  if (Object.values(result).some(value => !Number.isFinite(value)) || result.w < 0.05 || result.h < 0.05) return null;
  return result;
}

/** Shape the model's answer into the `source` object the pipeline understands. */
export function normalizeInspection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const colors = Array.isArray(raw.clothingColors)
    ? raw.clothingColors.filter(value => /^#[0-9a-fA-F]{6}$/.test(String(value))).slice(0, 3).map(value => value.toUpperCase())
    : [];
  return {
    face: normalizeBox(raw.face),
    person: normalizeBox(raw.person),
    lowerThirdBusy: Boolean(raw.lowerThirdBusy),
    lowerThirdReason: raw.lowerThirdReason ? String(raw.lowerThirdReason).slice(0, 120) : '',
    clothingColors: colors,
    backgroundBrightness: ['light', 'dark', 'mixed'].includes(raw.backgroundBrightness) ? raw.backgroundBrightness : null,
    notes: raw.notes ? String(raw.notes).slice(0, 200) : ''
  };
}

/**
 * Extract one frame at `at` seconds (default: a third of the way in, so the presenter
 * is already in their settled pose) as a JPEG no wider than `width`.
 */
export async function grabFrame({ videoPath, outDir, at = 2, width = 720, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg' }) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'source-frame.jpg');
  try {
    await run(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', videoPath, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '3', file]);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return existsSync(file) ? file : null;
}

/**
 * Look at the footage once and return `{ frame, source }`. `source` is null when the
 * tools are missing; callers treat that as "no observations", never as a failure.
 */
export async function inspectSource({ videoUrl, videoPath, outDir, llm, duration, ffmpeg, fetchImpl, logger = () => {} }) {
  if (!llm || typeof llm.generateContent !== 'function') return { frame: null, source: null };
  mkdirSync(outDir, { recursive: true });
  let localPath = videoPath;
  if (!localPath) {
    if (!videoUrl) return { frame: null, source: null };
    localPath = join(outDir, 'source.mp4');
    if (!existsSync(localPath)) {
      logger(`inspect: downloading source ${videoUrl.slice(0, 80)}`);
      await downloadFile(videoUrl, localPath, { fetchImpl });
    }
  }
  const at = duration ? Math.min(Math.max(1, duration / 3), 8) : 2;
  const frame = await grabFrame({ videoPath: localPath, outDir, at, ffmpeg });
  if (!frame) {
    logger('inspect: ffmpeg not available, skipping the source look');
    return { frame: null, source: null };
  }
  const image = readFileSync(frame).toString('base64');
  const result = await llm.generateContent({
    user: INSPECT_PROMPT,
    parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  });
  const source = normalizeInspection(parseJson(result?.content));
  if (source) {
    logger(`inspect: face ${source.face ? `${Math.round(source.face.y * 100)}-${Math.round((source.face.y + source.face.h) * 100)}%` : 'n/a'}, lower third ${source.lowerThirdBusy ? 'busy' : 'clean'}${source.lowerThirdReason ? ` (${source.lowerThirdReason})` : ''}`);
  }
  return { frame, source, model: llm.model, usage: result?.usage };
}
