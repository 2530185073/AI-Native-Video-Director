#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from './config.js';
import { directSecondCut } from './pipeline.js';
import { createLayout } from './layout/layout.js';
import { resolveMedia } from './media.js';
import { reviewRender } from './review.js';
import { createLLM } from './providers/llm/index.js';
import { createImageProvider } from './providers/image/index.js';
import { createVectCutClient } from './vectcut/client.js';

const HELP = `AI Native Video Director — 数字人口播二次精剪

用法:
  node src/cli.js --video <mp4 url> --audio <mp3 url> --script <文案.txt> [选项]

必填:
  --video URL|FILE     初版成片 mp4（公网链接，或本地文件路径：自动上传到 VectCut 临时存储）
  --script FILE|TEXT   原始口播文案（文件路径或直接文本）

可选:
  --audio URL|FILE     文案对应的 mp3；不传且 --video 是本地文件时，用 ffmpeg 自动抽取音频
  --words FILE         已有的逐字时间戳 JSON/SRT（跳过 ASR）
  --brief FILE         需求简报 JSON（平台/受众/目的/品牌色/风格）
  --person x,y,w,h     数字人在画面中的位置框（0-1 比例或像素）
  --face x,y,w,h       脸部位置框（可选，默认从人物框推算）
  --canvas WxH         画幅，默认 1080x1920
  --bgm URL|none       强制指定背景音乐（默认由 AI 从内置曲库选曲；none 关闭）
  --bgm-volume 0.12    背景音乐音量（线性，1 = 原音量；内部换算成 VectCut 的 dB）
  --sfx-volume 0.55    音效总音量（线性）
  --replace-audio      用 mp3 替换视频原声
  --from-plan FILE     直接使用已审核的 plan.json，跳过 LLM
  --name NAME          草稿名
  --render             生成草稿后提交云渲染并等待结果
  --review             渲染完成后自动审片：ffmpeg 抽帧拼 contact-sheet.jpg，并让 Gemini 看图打分写 review.json（隐含 --render）
  --resolution 1080P   渲染分辨率（默认 1080P）
  --dry-run            只生成 plan 与操作列表，不调用 VectCut
  --out DIR            输出目录（默认 ./out/<时间戳>）
  --env FILE           .env 路径（默认 ./.env）
  -h, --help           帮助

环境变量见 .env.example。`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') && token !== '-h') { args._.push(token); continue; }
    const key = token.replace(/^--?/, '');
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

function readMaybeFile(value) {
  if (!value) return undefined;
  try {
    return readFileSync(resolve(String(value)), 'utf8');
  } catch {
    return String(value);
  }
}

function parseBox(value) {
  if (!value) return undefined;
  const parts = String(value).split(/[,\s]+/).map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) throw new Error(`invalid box: ${value} (expected x,y,w,h)`);
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function parseCanvas(value) {
  if (!value) return undefined;
  const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(value));
  if (!match) throw new Error(`invalid canvas: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.h || args.help || (!args.video && !args._.length)) {
    console.log(HELP);
    process.exit(args.video ? 0 : 1);
  }
  loadEnvFile(args.env || '.env');

  const script = readMaybeFile(args.script);
  if (!script) throw new Error('--script is required');
  const words = args.words ? JSON.parse(readFileSync(resolve(args.words), 'utf8')) : undefined;
  const brief = args.brief ? JSON.parse(readFileSync(resolve(args.brief), 'utf8')) : undefined;
  const dryRun = Boolean(args['dry-run']);
  const review = Boolean(args.review) && !dryRun;
  const outDir = resolve(args.out || join('out', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(outDir, { recursive: true });

  const logger = message => console.error(`[director] ${message}`);

  let llm;
  if (args['from-plan']) {
    const plan = JSON.parse(readFileSync(resolve(args['from-plan']), 'utf8'));
    llm = { generateJson: async () => ({ data: plan, mode: 'from-plan' }) };
  } else {
    llm = createLLM();
  }

  // The client is also the default ASR provider, so create it whenever a key exists (dry runs included).
  const vectcut = process.env.VECTCUT_API_KEY ? createVectCutClient({ logger: message => logger(`vectcut ${message}`) }) : null;
  if (!dryRun && !vectcut) throw new Error('VECTCUT_API_KEY is required unless --dry-run');
  const imageProvider = dryRun ? null : createImageProvider({ client: vectcut });

  const bgmArg = args.bgm ?? process.env.BGM_URL;
  const bgmUrl = bgmArg && bgmArg !== 'none' ? bgmArg : undefined;
  const numberOr = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

  try {
    // Local files (e.g. D:\clips\take1.mp4) are uploaded to VectCut temp storage; audio is extracted with ffmpeg.
    const media = await resolveMedia({ video: args.video, audio: args.audio, client: vectcut, logger });

    const result = await directSecondCut({
      videoUrl: media.videoUrl,
      audioUrl: media.audioUrl,
      script,
      words,
      brief,
      person: parseBox(args.person),
      face: parseBox(args.face),
      canvas: parseCanvas(args.canvas),
      bgmUrl,
      disableBgm: bgmArg === 'none',
      bgmVolume: numberOr(args['bgm-volume'] ?? process.env.BGM_VOLUME, undefined),
      sfxVolume: numberOr(args['sfx-volume'] ?? process.env.SFX_VOLUME, undefined),
      replaceAudio: Boolean(args['replace-audio']),
      name: args.name,
      render: Boolean(args.render) || review,
      renderOptions: { resolution: args.resolution || '1080P' },
      dryRun
    }, { llm, vectcut, imageProvider, logger });

    writeFileSync(join(outDir, 'chunks.json'), JSON.stringify(result.chunks, null, 2));
    writeFileSync(join(outDir, 'plan.json'), JSON.stringify(result.plan, null, 2));
    writeFileSync(join(outDir, 'ops.json'), JSON.stringify(result.ops, null, 2));
    writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ...result, chunks: undefined, ops: undefined }, null, 2));

    // Post-render QC: contact sheet + vision review. Never fails the run — it produces evidence.
    let qc = null;
    if (review && result.render?.result) {
      try {
        const reviewer = typeof llm.generateContent === 'function' ? llm : (process.env.LLM_API_KEY || process.env.GOOGLE_GEMINI_API_KEY ? createLLM() : null);
        qc = await reviewRender({
          videoUrl: result.render.result,
          plan: result.plan,
          chunks: result.chunks,
          duration: result.timeline.duration,
          outDir,
          llm: reviewer,
          brief,
          layout: createLayout(result.layout),
          logger
        });
        writeFileSync(join(outDir, 'review.json'), JSON.stringify({ frames: qc.frames, sheet: qc.sheet, review: qc.review }, null, 2));
      } catch (error) {
        logger(`review skipped: ${error.message}`);
      }
    }

    console.log(JSON.stringify({
      outDir,
      concept: result.plan.concept,
      chunks: result.chunks.length,
      beats: result.plan.beats.length,
      lintWarnings: result.lintWarnings,
      draft: result.draft,
      render: result.render ? { status: result.render.status, url: result.render.result } : null,
      review: qc ? { sheet: qc.sheet, verdict: qc.review?.verdict, overall: qc.review?.overall, scores: qc.review?.scores, issues: qc.review?.issues, summary: qc.review?.summary } : null
    }, null, 2));
  } catch (error) {
    logger(`failed: ${error.message}`);
    if (error.errors) logger(error.errors.join('\n'));
    if (error.lastPlan) writeFileSync(join(outDir, 'plan.invalid.json'), JSON.stringify(error.lastPlan, null, 2));
    if (error.draftId) logger(`partial draft: ${error.draftId} ${error.draftUrl || ''}`);
    process.exit(1);
  }
}

main();
