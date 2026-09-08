# 填好的用户消息示例

对应输出见同目录 `plan.example.json`。把下面整段当作 user；system 用 `SKILL.md`。

```
## 视频信息
时长：8.2 秒，共 3 个字幕片段。
画幅 1080x1920。构图：tight。
人脸大约在画面高度 25%–55%；衣着主色深蓝；字幕区不杂乱。

## 这条视频的节奏预算（参考值，最终由内容决定）
信息密度中等。punch 约 2-3 个，zoom 约 1-2 次，broll 约 1-2 张。
hook：片段 1 应有 punch；前 3 秒不要 fullscreen / pip_face。
重要介绍段必须各配至少一张 AI 配图。最后一句要看见人脸。

## 需求简报
发布平台：抖音
目标观众：30-45 岁收藏爱好者
视频目的：讲清真银元和假货的价格差，引导私信
风格要求：专业但不高冷，重点数据一定要看得见
无额外禁止事项。

## 原始文案
你以为真银元很贵？一枚流通品大概一万块。看币，越看越懂。

## 字幕片段表（id | 开始-结束秒 | 字幕文本）
1 | 0.10-2.40 | 你以为真银元很贵？
2 | 2.40-5.20 | 一枚流通品大概一万块。
3 | 5.20-8.20 | 看币，越看越懂。

## 可用词表（只能从这里选，名称/ID 必须一字不差）
（此处可粘贴 catalog.md；若 system 已含 SKILL.md 第 5.1 节，可省略。）

## 输出要求
只输出一个 JSON 对象，不要解释。字段：
- concept、tone、bgm、subtitleStyle、chunks、beats
- 时间只用 chunk id（chunkId / fromChunk / toChunk），不要写秒数
- chunks 必须覆盖上面片段表里每一个 id
- punch.text / highlights 必须来自对应字幕
- 花字 position 用 above_head 或 top，不要用 chest
- 字幕不要开黑色底条
```
