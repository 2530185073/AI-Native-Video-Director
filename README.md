# AI-Native-Video-Director

> 给数字人口播成片做 **AI 导演级二次精剪**：AI 决定哪句要高亮、哪个词要砸大字、哪里推镜、哪里补画面，然后通过 VectCut（流光剪辑）接口落成可编辑草稿并云渲染。

不是套模板。模板决定“长什么样”，这里由 AI 根据**这一条**文案的内容、节奏和目的决定“该做什么、不该做什么”，规则层只负责兜底（不遮脸、不过密、不越权）。

---

## 输入 → 输出

```
初版 mp4（数字人成片，气口已剪，人物位置固定）
文案对应 mp3（可选，做 ASR 更干净）
原始文案
逐字对照（默认 Groq Whisper 词级时间戳 + 本地字符级对齐；也可接你自己的接口 / 直接传时间戳 / VectCut 兜底）
数字人在画面中的位置框（可选，有默认值）
        │
        ▼
 ① 逐字时间轴        文案的每个字 ↔ 音频时间戳（Levenshtein 字符级对齐）
 ② 短句切片          8-14 字一屏、按停顿和标点切，带逐字时间
 ③ AI 导演决策       Gemini 原生 generateContent，系统提示 = skills/talking-head-second-cut/SKILL.md → Editing Plan JSON
 ④ 规则审片 lint     高亮必须在字幕里、不遮脸、不进平台 UI 遮挡区、前 3 秒不切全屏图、推镜 ≥2s 且间隔 ≥2.5s、
                    B-roll ≤35% 且全屏 ≥2s、音效语法、>8s 静止段补轻推、每分钟密度上限……
 ⑤ 编译             Plan → VectCut 操作序列（纯函数，可 dry-run 审阅）
 ⑥ 执行             建草稿 / 主视频 / BGM 铺满 / 关键帧推镜 / 批量字幕 / 花字 / 生图 B-roll / 特效 / 音效 / query_script 校验
 ⑦ 云渲染（可选）    generate_video → task_status → mp4
 ⑧ 视觉审片（可选）  ffmpeg 抽帧（hook / 每个 beat / 中段 / 结尾）拼 contact-sheet.jpg → Gemini 看图打分 review.json
        │
        ▼
可在剪映里继续改的草稿 + 渲染成片 + plan.json / ops.json / review.json 留档
```

---

## AI 能决策什么（全部通过 VectCut API 落地）

| 决策 | 落地方式 | VectCut 接口 |
| --- | --- | --- |
| 字幕整体风格：字体、字号、描边、位置、入场 | 全片统一样式，一次批量写入 | `add_batch_text`（失败自动逐条 `add_text`） |
| 每句要变色/放大的关键词（0-2 个） | `text_styles` 局部样式 | `add_batch_text.text_styles_list` |
| 爆点词大字（数字/价格/结论/反转/CTA） | 花字 or 纯色大字 + 入场/循环/出场动画，出现在人物头顶/脸侧/顶部 | `add_text` + `effect_effect_id` |
| 镜头轻推强调（1.08-1.2，2-5 秒回落） | `uniform_scale` + `position_*_px` 关键帧，锁定脸部不跑偏 | `add_video_keyframe` |
| B-roll 补画面（商品/场景/对比/数据） | AI 写生图 prompt → 生图 → 全屏 / 头顶卡片 / 脸侧画中画 / 字幕上横卡 | 生图聚合接口 + `add_image` |
| 场景特效（转折色差故障、开场模糊、电影画幅…） | 极低频、短时长 | `add_effect` |
| 音效（pop / ding / whoosh / click / error / success） | 挂在 beat 上，在花字弹出、全屏图切入、金句的瞬间响一下；自动裁到最有力的 0.4-0.9 秒，双轨避免撞车 | `add_audio` |
| 背景音乐选曲（Lo-Fi / 软垫乐 / 轻快口播 / 不加） | 按内容气质选，全片 12% 音量铺满（短曲自动循环、首尾淡入淡出） | `add_audio` |
| 什么都不做 | `hide` 片段 / 不给 beat | — |

所有效果名与花字 ID 都来自一份**云渲染可用**的词表（`src/director/catalog.js`），AI 只能从中选，避免渲染时静默丢效果。音效/音乐素材在 `src/director/audio.js`，可换成自己的授权素材。

> 注意：VectCut `add_audio` 的 `volume` 是 **dB** 不是线性值（传 `0.12` 等于 +0.12 dB ≈ 原音量）。本项目配置一律用直观的线性值（`BGM_VOLUME=0.12`），编译器内部换算成 `-18.42 dB`，`query_script` 里可以看到草稿实际 `volume: 0.12`。

---

## 快速开始

```bash
cp .env.example .env   # 填 LLM_API_KEY / VECTCUT_API_KEY / GROQ_API_KEY（其余可选）
npm test               # 36 个单测 + mock 端到端

# 只出方案不花钱：dry-run 生成 plan.json + ops.json
node src/cli.js \
  --video https://cdn.example.com/first-cut.mp4 \
  --audio https://cdn.example.com/voice.mp3 \
  --script ./script.txt \
  --person 0.2,0.18,0.6,0.82 \
  --brief ./brief.json \
  --dry-run

# 正式生成草稿（并云渲染）
node src/cli.js --video ... --audio ... --script ./script.txt --render

# 渲染后自动审片：抽帧拼图 + Gemini 视觉打分（hook / 可读性 / 遮脸 / 安全区 / 节奏 / 风格），输出 review.json
node src/cli.js --video ... --audio ... --script ./script.txt --review

# 固定一首 BGM / 关掉 BGM / 调音量（线性值）
node src/cli.js ... --bgm https://assets.mixkit.co/music/764/764.mp3 --bgm-volume 0.12 --sfx-volume 0.5
node src/cli.js ... --bgm none
```

`--from-plan plan.json` 可以跳过 LLM，用人工审过/改过的方案直接出草稿；`--words words.json` 传入你自己的逐字时间戳（任意常见格式，宽松解析）。

`brief.json` 示例：

```json
{
  "platform": "抖音",
  "audience": "30-45 岁收藏爱好者",
  "goal": "引导私信咨询",
  "brand": { "name": "XX 藏品", "primaryColor": "#FFD700", "avoid": "不要红色、不要综艺感" },
  "styleNotes": "专业但不高冷，重点数据一定要看得见"
}
```

程序化调用：

```js
import { directSecondCut, createLLM, createVectCutClient, createImageProvider } from './src/index.js';

const vectcut = createVectCutClient();
const result = await directSecondCut(
  { videoUrl, audioUrl, script, person: { x: 0.2, y: 0.18, w: 0.6, h: 0.82 }, brief },
  { llm: createLLM(), vectcut, imageProvider: createImageProvider({ client: vectcut }) }
);
console.log(result.draft.url, result.plan);
```

---

## Editing Plan（AI 的输出）

AI 不写秒数，只引用字幕片段 id；时间由代码从对齐结果解析，杜绝时间轴漂移。完整 schema 见 `src/director/schema.js`，示例：

```json
{
  "concept": "知识类口播：白字黑边+黄色高亮，克制推镜，讲到实物时全屏图",
  "tone": "authoritative",
  "bgm": { "track": "lofi_clean", "reason": "知识类内容，干净的 Lo-Fi 不抢戏" },
  "subtitleStyle": { "font": "SourceHanSansCN_Bold", "fontSize": 10, "color": "#FFFFFF", "strokeColor": "#000000", "strokeWidth": 20, "highlightColor": "#FFE14D", "highlightScale": 1.25, "position": "lower_third", "intro": null },
  "chunks": [ { "id": 2, "highlights": ["一万"] }, { "id": 7, "highlights": ["26.8克"] } ],
  "beats": [
    { "type": "punch", "chunkId": 2, "text": "一万块", "flowerId": "W0BpSlRRRldCZlhQTFpAaERcUw==", "fontSize": 20, "intro": "弹入", "loop": "轻微跳动", "position": "above_head", "sfx": "ding", "reason": "价格是 hook" },
    { "type": "zoom", "fromChunk": 3, "toChunk": 4, "scale": 1.12, "reason": "结论句强调" },
    { "type": "broll", "fromChunk": 7, "toChunk": 7, "prompt": "一枚民国袁大头银元放在电子秤上，特写，柔和侧光，写实摄影，画面中没有文字", "layout": "fullscreen", "imageIntro": "渐显", "reason": "讲到具体重量，需要看到实物" },
    { "type": "effect", "fromChunk": 12, "toChunk": 12, "name": "色差故障", "reason": "结尾反转" }
  ]
}
```

---

## 目录

```
src/
  asr/            Groq Whisper（默认）、字符级对齐、外部逐字对照适配、VectCut ASR 兜底、（可选）去气口
  timeline/       任意 ASR 输出归一化、短句切片器
  layout/         人物框 → VectCut 中心坐标系像素位置、推镜锚点
  director/       效果词表、音效/BGM 素材库、Plan schema、prompt（加载 SKILL.md + 节奏预算）、planner（校验+修复循环）、lint
  review.js       渲染后 QC：抽帧 → contact sheet → 视觉审片
  providers/      llm/gemini（默认，原生 generateContent）+ openai-compatible 备用、image（VectCut 聚合 / OpenAI-compatible）
  vectcut/        真实 API 客户端、Plan→操作编译器、执行器（fallback/dry-run）、缩放换算
  pipeline.js     编排
  cli.js          命令行
test/             node:test，全部 mock，不需要任何 key
skills/           talking-head-second-cut/SKILL.md —— 导演技能本体（决策流程、硬指标、反模式、来源）
docs/             architecture.md（模块细节）、inputs.md（输入清单与“还缺什么”）、asr.md、research-notes.md（调研结论 → 落地对照）
```

---

## 设计取舍

- **AI 决策，代码执行。** LLM 只输出“意图”（哪个片段、什么类型、为什么），像素坐标、时间戳、接口参数全部由确定性代码生成，可测、可回放。
- **词表白名单。** 只暴露云渲染支持的动画/花字/字体，宁少勿错。
- **先 dry-run 再花钱。** `ops.json` 就是将要发给 VectCut 的每一次调用，人可以先看。
- **降级链。** 批量字幕失败→逐条；特效/BGM 失败→跳过并记录；结构化输出被拒→json_object→纯文本解析；LLM 方案不合规→带错误信息重试。
- **去气口不在主链路。** 你的初版已经剪掉气口，`src/asr/debreath.js` 保留为可选工具。

## 路线

- [x] 数字人口播二次精剪 MVP（本仓库）
- [x] 音效层：AI 在 punch/broll/effect 上挂音效，BGM 选曲 + 12% 铺满
- [x] 逐字对照：Groq Whisper + 字符级对齐为默认（27s 口播 5s 出结果、98% 对齐）；VectCut sta 模式作为无 Groq 时的兜底
- [x] 导演技能包：把口播剪辑的行业经验（hook 优先、按转折打断、推镜/B-roll/音效硬指标）写成 SKILL.md 直接作为系统提示，lint 用同一套数字守门
- [x] 视觉审片：`--review` 渲染后抽帧拼图给 Gemini，检查 hook / 可读性 / 遮脸 / 安全区 / 节奏 / 风格一致并给出按秒数的修法
- [ ] 审片结果回灌导演自动重剪（Reviewer → Director 闭环）
- [ ] 字在人后（`submit_remove_bg_text_behind_task`）作为 opening hook 选项
- [ ] 多条成片的风格记忆（同账号统一色系与花字）
