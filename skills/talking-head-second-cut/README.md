# 口播二次精剪 · 可移植导演 Skill

给**任意模型**当「后期总监」：读文案和字幕片段表，只输出一份 `plan.json`。本仓库的编译器 / VectCut 负责落到成片，模型不碰时间轴、不调接口。

```
任意模型（Claude / GPT / Gemini / 本地）
        │  system = SKILL.md
        │  user   = user-prompt.template.md 填好的内容
        ▼
    plan.json   ← 只这一份决策
        │
        ▼
node src/cli.js --from-plan plan.json --video … --script … --render
        │
        ▼
草稿 + 云渲染 mp4
```

本仓库默认路径里，Gemini 也会读同一份 `SKILL.md` 当 system prompt（`src/director/prompt.js` 会去掉 YAML 和「来源」节）。换模型 = 换 LLM，不必改决策规则。

## 目录

| 文件 | 给谁 | 做什么 |
| --- | --- | --- |
| `SKILL.md` | 任何模型的 **system prompt** | 心法、流程、硬指标、反模式、输出契约 |
| `catalog.md` | 模型（贴进 user）/ 人 | 全部合法名称与花字 ID |
| `user-prompt.template.md` | 调用方 | 填视频信息、文案、片段表后发给模型 |
| `output.schema.json` | 支持 Structured Output 的模型 | 机器校验用 JSON Schema |
| `examples/plan.example.json` | 对照 | 一份合法 plan 形状 |

## 其他模型怎么用（不跑本仓库也行）

1. System：整份 `SKILL.md`（可去掉文末「来源」）。
2. User：按 `user-prompt.template.md` 填。词表可直接粘 `catalog.md`，或只贴「可用词表」那一节。
3. 要求模型 **只输出 JSON**。有 Structured Output 的，把 `output.schema.json` 挂上。
4. 校验：每个 `chunks[].id` 必须出现在你给的片段表里；`beats` 只引用这些 id；`highlights` / `punch.text` 必须是对应字幕里的子串或精炼。
5. 把 JSON 存成 `plan.json`。

模型**不要**写秒数、不要发明花字 ID、不要给字幕加黑底、不要把花字放 `chest`。

## 接到本仓库出成片

```bash
# 1) 其他模型产出 plan.json 之后：
node src/cli.js \
  --video ./first-cut.mp4 \
  --audio ./voice.mp3 \
  --script ./script.txt \
  --words ./words.json \
  --brief ./brief.json \
  --from-plan ./plan.json \
  --render
```

`--from-plan` 会跳过本仓库内置的 Gemini 导演，改用你这份 JSON。本地 `normalizePlan` / `lint` 仍会锁字幕样式、把 `chest` 抬到 `top`、默认垫乐 `talk_default`。

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

## 产品锁（模型写错也会被系统改掉）

- 字幕：新青年体 / 13 / `#FFFFFF` / 描边 `#000000` 宽 40 透明度 40 / `transformY=-0.4` / **无黑色底条**
- 花字默认画面最上方（`top` / `above_head`），禁止压在字幕上
- 默认垫乐 `talk_default`（Faceu 口播垫乐）
