#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from './config.js';
import { directSecondCut } from './pipeline.js';
import { createLayout } from './layout/layout.js';
import { isLocalFile, resolveMedia } from './media.js';
import { reviewRender } from './review.js';
import { inspectSource } from './inspect.js';
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
  --fix                审片判定为 fix 时，把问题回灌给导演重做一版并再次渲染、审片（最多 1 轮；隐含 --review）
  --no-inspect         跳过开拍前的素材检查（默认：抽一帧让 Gemini 看人脸位置 / 字幕区是否杂乱 / 衣着颜色）
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
  const fix = Boolean(args.fix) && !dryRun;
  const review = (Boolean(args.review) || fix) && !dryRun;
  const inspect = !args['no-inspect'] && !args['from-plan'];
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
  // Vision entry point for the pre-flight look and the post-render review.
  const visionLlm = () => (typeof llm.generateContent === 'function' ? llm : (process.env.LLM_API_KEY || process.env.GOOGLE_GEMINI_API_KEY ? createLLM() : null));

  // The client is also the default ASR provider, so create it whenever a key exists (dry runs included).
  const vectcut = process.env.VECTCUT_API_KEY ? createVectCutClient({ logger: message => logger(`vectcut ${message}`) }) : null;
  if (!dryRun && !vectcut) throw new Error('VECTCUT_API_KEY is required unless --dry-run');
  const imageProvider = dryRun ? null : createImageProvider({ client: vectcut });

  const bgmArg = args.bgm ?? process.env.BGM_URL;
  const bgmUrl = bgmArg && bgmArg !== 'none' ? bgmArg : undefined;
  const numberOr = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

  const writeOutputs = (dir, result) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'chunks.json'), JSON.stringify(result.chunks, null, 2));
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(result.plan, null, 2));
    writeFileSync(join(dir, 'ops.json'), JSON.stringify(result.ops, null, 2));
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...result, chunks: undefined, ops: undefined, words: undefined }, null, 2));
  };

  try {
    // Local files (e.g. D:\clips\take1.mp4) are uploaded to VectCut temp storage; audio is extracted with ffmpeg.
    const media = await resolveMedia({ video: args.video, audio: args.audio, client: vectcut, logger });

    // Pre-flight: one frame of the footage tells the director where the face is, whether the
    // subtitle band is busy and what colours the clothes are. Never fatal.
    let source = null;
    let person = parseBox(args.person);
    let face = parseBox(args.face);
    if (inspect) {
      try {
        const looked = await inspectSource({
          videoUrl: media.videoUrl,
          videoPath: isLocalFile(args.video) ? resolve(String(args.video)) : undefined,
          outDir,
          llm: visionLlm(),
          logger
        });
        source = looked.source;
        if (source) {
          writeFileSync(join(outDir, 'source.json'), JSON.stringify({ frame: looked.frame, ...source }, null, 2));
          if (!face && source.face) { face = source.face; logger(`inspect: using detected face box ${JSON.stringify(face)}`); }
          if (!person && source.person) { person = source.person; logger(`inspect: using detected person box ${JSON.stringify(person)}`); }
        }
      } catch (error) {
        logger(`inspect skipped: ${error.message}`);
      }
    }

    const baseInputs = {
      videoUrl: media.videoUrl,
      audioUrl: media.audioUrl,
      script,
      words,
      brief,
      source,
      person,
      face,
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
    };

    // Post-render QC: contact sheet + vision review. Never fails the run — it produces evidence.
    const runReview = async (dir, result) => {
      if (!review || !result.render?.result) return null;
      try {
        const qc = await reviewRender({
          videoUrl: result.render.result,
          plan: result.plan,
          chunks: result.chunks,
          duration: result.timeline.duration,
          outDir: dir,
          llm: visionLlm(),
          brief,
          layout: createLayout(result.layout),
          canvas: result.layout?.canvas,
          logger
        });
        writeFileSync(join(dir, 'review.json'), JSON.stringify({ probe: qc.probe, frames: qc.frames, sheet: qc.sheet, review: qc.review }, null, 2));
        return qc;
      } catch (error) {
        logger(`review skipped: ${error.message}`);
        return null;
      }
    };

    let result = await directSecondCut(baseInputs, { llm, vectcut, imageProvider, logger });
    writeOutputs(outDir, result);
    let qc = await runReview(outDir, result);
    let rounds = [];

    // The reviewer's notes go back to the director once: same footage, same timeline, a
    // plan that has to answer each issue. The first cut is kept under v1/ for comparison.
    if (fix && qc?.review?.verdict === 'fix' && qc.review.issues?.length) {
      logger(`fix round: ${qc.review.issues.length} issue(s) fed back to the director`);
      const firstDir = join(outDir, 'v1');
      writeOutputs(firstDir, result);
      writeFileSync(join(firstDir, 'review.json'), JSON.stringify({ probe: qc.probe, frames: qc.frames, sheet: qc.sheet, review: qc.review }, null, 2));
      rounds.push({ dir: firstDir, verdict: qc.review.verdict, overall: qc.review.overall });
      const revised = await directSecondCut({
        ...baseInputs,
        words: result.words,
        brief: { ...(brief || {}), reviewFeedback: qc.review.issues },
        name: args.name ? `${args.name} v2` : undefined
      }, { llm, vectcut, imageProvider, logger });
      result = revised;
      writeOutputs(outDir, result);
      qc = await runReview(outDir, result);
      rounds.push({ dir: outDir, verdict: qc?.review?.verdict, overall: qc?.review?.overall });
    }

    console.log(JSON.stringify({
      outDir,
      concept: result.plan.concept,
      framing: result.layout.framing,
      source: source ? { lowerThirdBusy: source.lowerThirdBusy, clothingColors: source.clothingColors } : null,
      chunks: result.chunks.length,
      beats: result.plan.beats.length,
      lintWarnings: result.lintWarnings,
      draft: result.draft,
      render: result.render ? { status: result.render.status, url: result.render.result } : null,
      review: qc ? { sheet: qc.sheet, verdict: qc.review?.verdict, overall: qc.review?.overall, scores: qc.review?.scores, capped: qc.review?.capped, issues: qc.review?.issues, summary: qc.review?.summary } : null,
      rounds: rounds.length ? rounds : undefined
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
