import { describeCatalog } from './catalog.js';

export const DIRECTOR_SYSTEM_PROMPT = `你是一位短视频后期总监，专门给“数字人口播”做二次精剪，目标是让成片有抖音/视频号/小红书的网感。

你拿到的素材已经是初版成片：数字人位置固定、气口已经剪掉、音画对齐。你不需要剪时间线，你要做的是导演层面的“包装决策”：
- 哪些字幕里的词值得变色/放大（highlights）
- 哪些词值得做成大字花字砸在人物头顶（punch）
- 哪几句需要镜头轻推强调（zoom）
- 哪几句在讲具体的东西，需要用图片补画面（broll）
- 极少数转折点是否需要场景特效（effect）
- 声音设计：哪些 beat 值得配一个短音效（sfx），以及全片用哪首垫乐（bgm）

网感的底层逻辑不是堆特效，而是“节奏 + 信息层级 + 情绪锚点”：
1. 前 3 秒必须抓人：第 1 个片段几乎总是值得一个 punch（把 hook 提炼成 2-6 个字）+ 一次轻推。
2. 每 5-8 秒画面要有一次变化（punch / zoom / broll 任意一种），但同一时刻不要叠 3 种。
3. 字幕高亮克制：一条字幕最多 1-2 个词，只高亮数字、价格、结论、动作、反转词；平铺直叙的句子一个都不要高亮。全片带高亮的片段不要超过一半——每句都亮等于没有重点。
4. punch 只给“值得被记住”的词：数字、价格、结果、反差、金句、CTA。每分钟 4-8 个。全片花字风格统一在 1-2 种，颜色体系和字幕 highlightColor 呼应。
5. zoom 用 1.08-1.2 的轻推，持续 2-5 秒后自然回落，用来强调结论句或情绪句；不要连续两句都推。
6. broll 只在“讲到具体对象”时用：商品、场景、步骤、对比、数据、案例。展示对象用 fullscreen（1.5-4 秒），补充信息用 card_top，参照物用 pip_side。prompt 要写画面而不是概念，说明构图、主体、光线、风格，并明确“画面中不要出现任何文字”，全片图片风格统一。
7. effect 是调味料：转折/反差可用 0.3-0.6 秒的 色差故障；开场可用 模糊开幕；其余情况宁缺毋滥。
8. 风格由内容决定，不是套模板：知识/商业内容偏克制（白字黑边+黄色高亮），带货/促销偏热（黄红金、花字更大），情感/故事偏文艺（纸纹/手写、渐显、少 punch），吐槽/娱乐偏综艺（综艺花字、晃动、故障）。
9. 音效是标点，不是背景：只给“画面发生变化”的 beat 加 sfx。花字弹出用 pop，价格/数字/金句用 ding，警告/避坑用 error，结论/正确做法用 success，全屏图或切卡进入用 whoosh，列表逐条用 click。大约一半的 punch 和绝大多数 fullscreen broll 值得加音效，zoom 通常不加；每分钟不超过 8 个，同一秒内不叠两个。
10. 垫乐：知识/干货/商业选 lofi_clean，情感/故事/慢节奏选 soft_pad，带货/生活/轻快选 talk_default；只有内容本身有音乐或极其严肃时选 none。垫乐音量由系统统一压低，你只需选曲。

硬性规则：
- 只能使用给定词表中的名称和 ID，一个字都不能改。
- 所有时间都通过片段 id 引用（chunkId / fromChunk / toChunk），绝对不要输出秒数。
- punch 的 text 必须是该片段里出现的词或它的精炼（不超过 8 个字），不要编造原文没有的信息。
- highlights 必须是该片段字幕文本中逐字出现的子串。
- 每个 beat 的 reason 用一句话说明为什么这里值得这样处理。
- 只输出 JSON，不要解释。`;

function formatChunks(chunks) {
  return chunks.map(chunk => `${chunk.id} | ${chunk.start.toFixed(2)}-${chunk.end.toFixed(2)} | ${chunk.text}`).join('\n');
}

function formatBrief(brief = {}) {
  const lines = [];
  if (brief.platform) lines.push(`发布平台：${brief.platform}`);
  if (brief.audience) lines.push(`目标观众：${brief.audience}`);
  if (brief.goal) lines.push(`视频目的：${brief.goal}`);
  if (brief.brand?.name) lines.push(`品牌：${brief.brand.name}`);
  if (brief.brand?.primaryColor) lines.push(`品牌主色（可作为 highlightColor / punch color 参考）：${brief.brand.primaryColor}`);
  if (brief.brand?.avoid) lines.push(`禁止事项：${brief.brand.avoid}`);
  if (brief.styleNotes) lines.push(`风格要求：${brief.styleNotes}`);
  if (brief.referenceStyle) lines.push(`参考风格：${brief.referenceStyle}`);
  return lines.length ? lines.join('\n') : '无额外要求，由你根据内容判断。';
}

function describeLayout(layout) {
  if (!layout) return '竖屏 1080x1920，数字人位于画面中央，头部约在上方 1/3 处。';
  const face = layout.face;
  const top = Math.round(face.y * 100);
  const bottom = Math.round((face.y + face.h) * 100);
  return `画幅 ${layout.canvas.width}x${layout.canvas.height}。数字人脸部占画面高度的 ${top}%~${bottom}%，横向偏${layout.freeSide === 'right' ? '左' : '右'}，因此${layout.freeSide === 'right' ? '右' : '左'}侧留白更多。头顶上方约 ${top}% 的高度可以放 punch / 卡片；字幕放在脸部以下。`;
}

export function buildDirectorUserPrompt({ script, chunks, brief, duration, layout, catalog, schema }) {
  return `## 视频信息
时长：${(duration || chunks[chunks.length - 1]?.end || 0).toFixed(1)} 秒，共 ${chunks.length} 个字幕片段。
${describeLayout(layout)}

## 需求简报
${formatBrief(brief)}

## 原始文案
${script}

## 字幕片段表（id | 开始-结束秒 | 字幕文本）
${formatChunks(chunks)}

## 可用词表（只能从这里选，名称/ID 必须一字不差）
${describeCatalog(catalog)}

## 输出要求
输出一个 JSON 对象，字段说明：
- concept：一句话说明这条视频的包装策略（风格、色彩体系、节奏）。
- tone：语气。
- bgm：{ track, reason }，track 从词表选或 none。
- subtitleStyle：全片字幕样式。fontSize 建议 9-12（竖屏口播），strokeWidth 建议 15-30，highlightScale 建议 1.15-1.35，intro 只在节奏快的内容上用（如 弹入 / 向上滑动），否则 null。background 一般关闭，只有背景杂乱时开启。
- chunks：每个片段一个条目，highlights 为要变色/放大的词（可以为空数组），hide 只在极少数需要“留白”的片段设为 true。所有片段都必须出现。
- beats：punch / zoom / broll / effect 列表。
  - punch：chunkId、text、flowerId（或 null 用纯色）、color（flowerId 为 null 时必填）、fontSize 14-26、intro、loop（或 null）、position、outro（或 null）。
  - zoom：fromChunk、toChunk、scale。
  - broll：fromChunk、toChunk、prompt、layout、imageIntro、outro（图片出场动画或 null）。
  - effect：fromChunk、toChunk、name。
  - 任意 beat 可带 sfx（音效 id 或 null），在 beat 开始的瞬间播放。

JSON Schema：
${JSON.stringify(schema)}`;
}

export function buildRepairPrompt(errors, previousJson) {
  return `你上一次输出的 JSON 没有通过校验，错误如下：
${errors.map(error => `- ${error}`).join('\n')}

请修正这些问题，保持其余决策不变，重新输出完整 JSON（只输出 JSON）。上一次的输出：
${JSON.stringify(previousJson).slice(0, 12000)}`;
}
