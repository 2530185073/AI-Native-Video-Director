# 口播二次精剪 · 可移植导演 Skill

给**任意模型**当后期总监：读文案和字幕片段表，只输出一份 `plan.json`。本仓库的编译器 / VectCut 落到成片；模型不碰时间轴、不调接口。

```
任意模型（Claude / GPT / Gemini / 本地 / Cursor）
        │  system = SKILL.md（已含词表速查）
        │  user   = 按 user-prompt.template.md 填好
        │  可选    output.schema.json / catalog.json
        ▼
    plan.json
        │
        ▼
node src/cli.js --from-plan plan.json --video … --script … --render
```

本仓库默认 Gemini 也读同一份 `SKILL.md`（`src/director/prompt.js` 会去掉 YAML 和「来源」节）。换模型 = 换 LLM，不必改决策规则。

## 目录

| 文件 | 给谁 | 做什么 |
| --- | --- | --- |
| `SKILL.md` | 任何模型的 **system prompt** | 心法、流程、硬指标、反模式、输出契约、**词表速查** |
| `skill.json` | 调用方 / 技能目录 | 清单、版本、产品锁、接入方式 |
| `catalog.md` | 模型（可再贴进 user）/ 人 | 完整合法名称与花字 ID |
| `catalog.json` | API / Structured Output | 同上，机器可读 |
| `user-prompt.template.md` | 调用方 | 填视频信息、文案、片段表后发给模型 |
| `output.schema.json` | 支持 Structured Output 的模型 | 机器校验 |
| `examples/user.example.md` | 对照 | 填好的 user |
| `examples/plan.example.json` | 对照 | 对应的合法 plan |
| `env.required.md` | 另一台机器 | 要填哪些环境变量（只有名字，没有值） |

把**整个目录**交给另一个模型或同事即可，不必再解释规则。

**这里没有 API key。** 钥匙只放各机 `.env`（git 已忽略）。另一台机器要无缝出片：拷仓库 + 拷那份 `.env`（或按 `.env.example` 另填），然后 `node src/cli.js --check`。变量名见 `env.required.md`。

## 其他模型怎么用

### 1）对话产品（Claude / ChatGPT / Gemini 网页）

1. System / 自定义指令 / Project 知识：整份 `SKILL.md`（可删文末「来源」）。
2. 用户消息：按 `user-prompt.template.md` 填。需要加强约束时再粘 `catalog.md`。
3. 要求 **只输出 JSON**。对照 `examples/` 看形状。
4. 存成 `plan.json`。

### 2）API（OpenAI / Anthropic / Gemini / 兼容接口）

```text
system: SKILL.md 全文
user:   填好的模板
response_format / structured output: output.schema.json
```

校验：每个 `chunks[].id` 必须在你给的片段表里；`beats` 只引用这些 id；`highlights` / `punch.text` 必须是对应字幕的子串或精炼。

### 3）装到 Cursor / Claude Code（让别的 agent 自动用）

```bash
# Cursor 项目级
cp -R skills/talking-head-second-cut .cursor/skills/

# Claude Code 项目级
cp -R skills/talking-head-second-cut .claude/skills/

# 或用户级
cp -R skills/talking-head-second-cut ~/.cursor/skills/
```

模型**不要**写秒数、不要发明花字 ID、不要给字幕加黑底、不要把花字放 `chest`。

## 另一台机器无缝开剪

Skill 只负责「怎么剪」；「用谁的账号去剪」必须在那台机器本地配。

```bash
git clone <本仓库> && cd AI-Native-Video-Director
# 把现有机器上的 .env 拷过来（不要提交、不要放进 skill）
# 或：cp .env.example .env 然后自己填 LLM_API_KEY / VECTCUT_API_KEY / GROQ_API_KEY
npm test
node src/cli.js --check    # 只报告缺哪把钥匙，不打印完整 key
# 装 ffmpeg（抽帧 / 审片 / 从本地 mp4 抽音频）
```

`--check` 通过后再跑 `--video … --script … --render`。只换导演模型、仍在本机出片：对方只出 `plan.json`，你这台继续 `--from-plan`。

## 接到本仓库出成片

```bash
node src/cli.js \
  --video ./first-cut.mp4 \
  --audio ./voice.mp3 \
  --script ./script.txt \
  --words ./words.json \
  --brief ./brief.json \
  --from-plan ./plan.json \
  --render
```

`--from-plan` 跳过内置 Gemini 导演，改用你这份 JSON。本地 `normalizePlan` / `lint` 仍会锁字幕样式、把 `chest` 抬到 `top`、默认垫乐 `talk_default`。

继续用本仓库内置导演（不换模型）：

```bash
node src/cli.js --video … --script … --brief … --render
```

## 调用方必须提供的输入

- **原始口播文案**（和片子里说的一致）
- **字幕片段表**：`id | 开始秒-结束秒 | 文本`。本仓库用 ASR + `buildChunks` 自动切；你也可以自己切（一屏约 8–14 字）。
- **时长、构图**（tight / medium / wide，或人脸框）
- **简报**（可选）：平台、受众、目的、品牌色、禁止事项

模型只做包装决策，不剪时间线。

## 产品锁（模型写错也会被本仓库改掉）

- 字幕：新青年体 / 13 / `#FFFFFF` / 描边 `#000000` 宽 40 透明度 40 / `transformY=-0.4` / **无黑色底条**
- 花字默认画面最上方（`top` / `above_head`），禁止压在字幕上
- 默认垫乐 `talk_default`（Faceu 口播垫乐）
