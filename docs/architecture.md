# 架构说明

## 分层

```
输入层        videoUrl / audioUrl / script / words? / person box / brief
时间轴层      asr/timeline.js → timeline/words.js → asr/alignment.js → timeline/chunker.js
布局层        layout/layout.js
决策层        director/{catalog,schema,prompt,planner,lint}.js  + providers/llm
编译层        vectcut/compiler.js（纯函数）
执行层        vectcut/executor.js + vectcut/client.js + providers/image
编排           pipeline.js / cli.js
```

每层的输入输出都是普通 JSON，可以单独替换或离线回放。

## 时间轴层

1. `getWordTimeline` 按优先级选源：内联 `words` → **Groq Whisper**（默认；词级时间戳。不传整段文案作 prompt——实测会让 large-v3 在部分片段整段幻听；转写后按文案逐字精确匹配率 `exactCoverage` 自检，低于阈值换 turbo 重试，仍低且有 VectCut 时自动转 VectCut 对齐）→ 外部对照接口（`ASR_ALIGN_URL`）→ VectCut 识别字幕兜底（`asr/vectcut.js`，传 `content` 走 sta 文案对齐模式，`segments[].words[]` 是逐字毫秒时间戳）。
2. `normalizeWords` 把任意形状的返回统一成 `[{ text, start, end }]`。
3. `alignScriptCharacters` 用 Levenshtein DP（Int32Array 行，2000×2000 也只有几 MB）把文案每个字对到 ASR 字上，得到逐字时间。
4. `buildChunks` 生成字幕片段：先按标点切句，再按 >0.35s 的停顿切，再对超过 14 字的句子在最大停顿处递归二分；标点从显示文本中去掉，但数字里的小数点保留。没对上的片段按字数在相邻片段之间插值，并标记 `interpolated`。短于 0.6s 的间隙会让字幕“撑到下一句”，避免闪烁。

片段带逐字 `chars`，`phraseTiming(chunk, '一万块')` 能返回这个词被说出的精确时刻——punch 大字就在这一刻弹出。

## 布局层

VectCut 使用画布中心坐标系（+y 向上）。注意它的 “px” 单位：`(width, height)` 是画面**右上角**，即坐标范围是 ±width / ±height，草稿里存的是 `px/height`，剪映把 1.0 当半个画布——所以想位移画面高度的 f，要传 `2·f·height`（真机验证过：传 806 只移了 21%，不是 42%）。`createLayout` 里统一做了这层换算（`PX_UNIT = 2`），接受 0-1 比例或像素的人物框/脸框，输出：

- `subtitle(position)`：lower_third / center_low / bottom → `transform_y_px`、`fixed_width`
- `punch(position)`：above_head（头顶空间不足自动改脸侧）/ beside_face（自动选留白一侧）/ center / top
- `broll(layout)`：card_top / fullscreen / pip_side / lower_card → 目标像素框 + 图片长宽比。全部按实测留白自适应：`card_top` 缩到头顶留白里放得下，放不下降级为 `lower_card`；`pip_side` 脸侧留白 < 26% 时也降级；`lower_card` 严格卡在下巴与字幕行之间（大头特写构图常见）
- `zoomAnchor(scale)`：推镜时补偿位移，让脸保持在原位
- `overlapsFace(y)`：lint 用

## 决策层

- **catalog**：只包含 `get_*_types` 中 `cloud_render_supported: true` 的名字和官方花字 ID 表的子集，每项带“何时用”的提示，直接渲染进 prompt。音效与 BGM 词表来自 `audio.js`（id、直链、`get_duration` 核验过的时长、裁剪长度、增益）。
- **schema**：AI 输出结构。所有时间用片段 id 引用；beat 类型 punch/zoom/broll/effect 的条件必填由 `validatePlan` 补充检查；每个 beat 可带 `sfx`（音效 id 或 null），顶层 `bgm.track` 选曲或 `none`。
- **prompt**：系统提示词写的是“网感”的方法论（前 3 秒 hook、5-8 秒一次变化、高亮克制、punch 只给值得记住的词、推镜 1.08-1.2、B-roll 只在讲具体对象时用、风格由内容决定），不是样式清单。
- **planner**：`generateJson` → `normalizePlan`（补齐缺失片段、纠正 id 字段）→ `validatePlan` → 失败则带错误列表让模型修复（最多 3 次）→ `lintPlan`。
- **lint**：高亮必须是字幕子串；字幕不压脸；同类 beat 不重叠；每分钟密度上限（punch 8 / broll 4 / effect 3 / sfx 8，超出按时间均匀抽稀）；两条音效间隔 <0.7s 时丢掉后者；punch 与全屏 B-roll 同时出现时上移到顶部；按时间排序。所有修正都返回 warnings。

## 编译层

`compilePlan` 输出有序操作列表：

```
create_draft → add_video → [add_audio 替换人声] → add_audio×N(BGM 循环铺满, optional)
→ add_video_keyframe(所有 zoom 合并成一次调用)
→ add_batch_text(全部字幕 + text_styles_list，附逐条 fallback)
→ add_text(每个 punch) / broll_image(每个 broll) / add_effect(每个 effect, optional)
→ add_audio(每个 sfx, 裁剪 + 双轨分配, optional)
→ query_script
```

`broll_image` 是高层操作：包含 prompt、长宽比、目标像素框和放置参数，由执行器决定用哪个生图 provider。图片缩放按“剪映 scale=1 是贴合画布的 contain 尺寸”换算（`vectcut/scale.js`）。

音量统一用线性值配置，`linearToDb` 换算成 VectCut 需要的 dB（0.12 → -18.42；0 → -100 静音）。BGM 时长已知时直接展开为 N 段 `add_audio`；自定义 URL 时长未知则输出 `bgm_fill`，由执行器 `get_duration` 后展开。

## 执行层

- `VectCutClient`：Bearer 鉴权、5xx 重试、`success:false` 转异常、异步任务轮询（ASR、生图、渲染）、`get_duration`、临时文件直传 OSS。
- `executeOps`：注入 `draft_id`；`fallback` 逐条重试；`optional` 失败只记录；`broll_image` 生图→算 scale→`add_image`；最后 `query_script` 摘要（轨道数、文字数、时长）作为校验；`dryRun` 直接返回操作列表。
- 出错时把已完成的 `draftId/draftUrl` 挂在异常上，草稿不会丢。

## 测试

`npm test` 运行 36 个 `node:test` 用例：切片器、布局、schema/lint/planner 修复循环、编译器参数（含 BGM 循环、dB 换算、音效裁剪与分轨）、执行器降级与 `bgm_fill` 展开、LLM 结构化输出降级、VectCut 客户端错误处理、VectCut ASR 轮询与逐字展开、生图 provider、外部 ASR 适配、mock 端到端。全部离线。

真实接口验证（2026-09，27s 口播）：Groq Whisper 5.3s 返回 137 词，字符级对齐覆盖 98%（VectCut sta 兜底路径同样跑通，切片时间差 ≤0.1s）；Gemini（OpenAI 兼容中转，`json_object` 模式）一次通过校验；草稿含 22 条字幕、4 个花字、2 张生图 B-roll、1 个特效、BGM（草稿内 `volume 0.120`）与 4 条音效；云渲染成功。
