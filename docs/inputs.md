# 输入清单与“还缺什么”

## 你已经有的（够跑通主链路）

| 输入 | 用途 | 传法 |
| --- | --- | --- |
| 初版 mp4（公网 URL） | 主轨视频 | `--video` / `videoUrl` |
| 文案对应 mp3（公网 URL） | ASR/对齐用音频（比从 mp4 提取更干净） | `--audio` / `audioUrl`；不传则用 mp4 |
| 原始文案 | 字幕文本源、AI 理解内容的依据 | `--script` / `script` |
| 逐字对照 | 把文案按时间戳对上音频 | **默认 Groq Whisper**（`GROQ_API_KEY`，词级时间戳 + 本地字符级对齐，文案作 prompt）。也可用 `ASR_ALIGN_URL` 接你自己的接口、`--words` 直接传结果文件；两者都没有时才用 VectCut「识别字幕」sta 模式兜底（计费） |
| VectCut API Key | 草稿/生图/渲染（ASR 兜底） | `VECTCUT_API_KEY` |
| 图片生成接口 | B-roll | `IMAGE_PROVIDER=vectcut`（默认，用 VectCut 聚合，无需上传）或 `openai-compatible`（Gemini/Imagen/自建网关） |
| Gemini Key | AI 导演 | `LLM_API_KEY`（OpenAI-compatible 端点，可换任何模型；中转站填 `LLM_BASE_URL=https://xxx/v1`） |
| 音效 / 背景音乐 | 声音设计 | 已内置在 `src/director/audio.js`（7 条 UI 音效 + 3 首垫乐，公网直链、时长已核验）。换素材改这个文件，或 `--bgm URL` 强制指定 |

### 音效与 BGM 的实际参数

- BGM 默认 `BGM_VOLUME=0.12`（线性 12%）。VectCut `add_audio.volume` 单位是 **dB**，程序自动换算成 `-18.42`；真实草稿 `query_script` 里 `volume: 0.120`。
- 音效默认 `SFX_VOLUME=0.55` × 素材 gain（约 -8 dB），每条裁到 0.4-0.9 秒，分两条轨道 `audio_sfx_1/2` 放置避免同轨重叠。
- BGM 短于视频时首尾相接循环铺满，第一段淡入 0.8s、最后一段淡出 1.2s；`--bgm none` 关闭。
- 自定义 `--bgm URL` 时会先 `get_duration` 拿时长再铺，`inputs.bgmDuration` 可省这一步。

### 逐字对照接口的返回格式

不要求固定格式。解析器会在返回 JSON 里递归找第一个“像逐字数组”的东西：每项含文本字段（`word|text|char|character|token|content`）和起止字段（`start|start_time|begin|…` / `end|end_time|…`）。秒/毫秒自动识别，也接受 SRT 字符串。如果你的接口用别的字段名接收参数，用 `ASR_ALIGN_AUDIO_FIELD` / `ASR_ALIGN_TEXT_FIELD` 改。

## 强烈建议补的（影响效果）

1. **数字人位置框 `--person x,y,w,h`（0-1 比例）**：决定字幕不遮脸、punch 放头顶还是脸侧、B-roll 卡片放哪。数字人项目里这个值是固定的，配一次就行。脸框 `--face` 可选，默认从人物框推算。
2. **需求简报 `--brief brief.json`**：平台、受众、目的、品牌色、禁忌、风格参考。没有它 AI 也能判断，但有它风格会更稳定、更贴账号。
3. **字幕安全区约束**：如果成片要发到有 UI 遮挡的平台（抖音右侧按钮、底部文案区），在 brief 里说明，或用 `--canvas` + `person` 让布局引擎留边。目前默认按 9:16 常规安全区。

## 现在做不到 / 需要你确认的

- **音效/音乐版权**：内置直链来自 tryelements.dev 与 Mixkit（可商用）以及剪映曲库的一条公开链接；上线前建议镜像到自己的 OSS，避免外链失效。
- **场景特效是否云渲染可用**：`get_video_scene_effect_types` 没标 `cloud_render_supported`，词表里只放了 8 个低风险特效，并且执行失败会跳过不阻塞。第一次跑建议看 `query_script` 校验和渲染结果，不行就把 `SCENE_EFFECTS` 清空。
- **字号手感**：VectCut 字号是剪映字号（默认 8）。词表建议字幕 9-12、punch 14-26，跑一条真实成片后按观感微调 `prompt.js` 里的建议区间。
- **视觉审片**：目前是规则审片（lint）。渲染后抽帧给多模态模型复审是下一阶段。
- **生图风格一致性**：每条 B-roll prompt 会附加全片 `concept` 作为风格约束；如需更强一致性可给 `reference_images`（VectCut 聚合接口支持），暂未在 plan 里暴露。

## 费用/耗时相关

- LLM：一条 1-2 分钟口播约 8-15k tokens 输入、2-4k 输出，通常 1 次通过，最多重试 3 次。
- Groq Whisper：27 秒音频约 5 秒返回，免费额度内够用。
- VectCut：草稿操作免费；生图、云渲染、ASR 兜底（约 3 积分/条）计费。`--dry-run` 只做 ASR，不建草稿、不生图、不渲染；传 `--words` 则完全离线。
- 实测：27 秒口播全流程（ASR 对齐 + Gemini 出方案 + 2 张生图 + 建草稿）约 110 秒，Gemini 一次通过（约 5.8k 输入 / 4.7k 输出 tokens）；云渲染 1080P 约 55 秒。
- 渲染：文档建议素材走素材库内链可提速 90%；mp4/mp3 建议先上传到 VectCut 素材库再传链接。
