# 输入清单与“还缺什么”

## 你已经有的（够跑通主链路）

| 输入 | 用途 | 传法 |
| --- | --- | --- |
| 初版 mp4（公网 URL） | 主轨视频 | `--video` / `videoUrl` |
| 文案对应 mp3（公网 URL） | ASR/对齐用音频（比从 mp4 提取更干净） | `--audio` / `audioUrl`；不传则用 mp4 |
| 原始文案 | 字幕文本源、AI 理解内容的依据 | `--script` / `script` |
| 逐字对照接口 | 把文案按时间戳对上音频 | `.env` 里 `ASR_ALIGN_URL` + 字段名映射；或直接 `--words` 传结果文件 |
| VectCut API Key | 草稿/生图/渲染 | `VECTCUT_API_KEY` |
| 图片生成接口 | B-roll | `IMAGE_PROVIDER=vectcut`（默认，用 VectCut 聚合，无需上传）或 `openai-compatible`（Gemini/Imagen/自建网关） |
| Gemini Key | AI 导演 | `LLM_API_KEY`（OpenAI-compatible 端点，可换任何模型） |

### 逐字对照接口的返回格式

不要求固定格式。解析器会在返回 JSON 里递归找第一个“像逐字数组”的东西：每项含文本字段（`word|text|char|character|token|content`）和起止字段（`start|start_time|begin|…` / `end|end_time|…`）。秒/毫秒自动识别，也接受 SRT 字符串。如果你的接口用别的字段名接收参数，用 `ASR_ALIGN_AUDIO_FIELD` / `ASR_ALIGN_TEXT_FIELD` 改。

## 强烈建议补的（影响效果）

1. **数字人位置框 `--person x,y,w,h`（0-1 比例）**：决定字幕不遮脸、punch 放头顶还是脸侧、B-roll 卡片放哪。数字人项目里这个值是固定的，配一次就行。脸框 `--face` 可选，默认从人物框推算。
2. **需求简报 `--brief brief.json`**：平台、受众、目的、品牌色、禁忌、风格参考。没有它 AI 也能判断，但有它风格会更稳定、更贴账号。
3. **字幕安全区约束**：如果成片要发到有 UI 遮挡的平台（抖音右侧按钮、底部文案区），在 brief 里说明，或用 `--canvas` + `person` 让布局引擎留边。目前默认按 9:16 常规安全区。

## 现在做不到 / 需要你确认的

- **音效（whoosh/ding）**：VectCut 有 `add_audio` 但没有内置音效库检索接口；需要你提供一组音效 URL（素材库链接），下一步可以让 AI 在 punch/zoom 处挂音效。
- **背景音乐**：`--bgm URL` 已支持（-18dB、淡入淡出），但选曲需要你给 URL。
- **场景特效是否云渲染可用**：`get_video_scene_effect_types` 没标 `cloud_render_supported`，词表里只放了 8 个低风险特效，并且执行失败会跳过不阻塞。第一次跑建议看 `query_script` 校验和渲染结果，不行就把 `SCENE_EFFECTS` 清空。
- **字号手感**：VectCut 字号是剪映字号（默认 8）。词表建议字幕 9-12、punch 14-26，跑一条真实成片后按观感微调 `prompt.js` 里的建议区间。
- **视觉审片**：目前是规则审片（lint）。渲染后抽帧给多模态模型复审是下一阶段。
- **生图风格一致性**：每条 B-roll prompt 会附加全片 `concept` 作为风格约束；如需更强一致性可给 `reference_images`（VectCut 聚合接口支持），暂未在 plan 里暴露。

## 费用/耗时相关

- LLM：一条 1-2 分钟口播约 8-15k tokens 输入、2-4k 输出，通常 1 次通过，最多重试 3 次。
- VectCut：草稿操作免费；生图和云渲染计费。`--dry-run` 不会触发任何计费。
- 渲染：文档建议素材走素材库内链可提速 90%；mp4/mp3 建议先上传到 VectCut 素材库再传链接。
