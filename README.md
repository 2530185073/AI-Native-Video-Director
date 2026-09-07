# Hunjian V9 - AI 网感视频剪辑 Agent

> 基于多模型 LLM + ASR 时间戳 + 生图模型 + VectCut 云剪辑 API 的智能视频生产底座。

## 项目目标

不是固定模板剪辑，而是让 AI 理解内容后自主决定：

- 哪些地方保留人物口播
- 哪些地方需要商品/案例/解释图片
- 哪些词需要重点字幕
- 哪些位置需要放大、对比、卡片化展示
- 什么时候需要节奏变化

最终生成可编辑草稿，并支持云渲染输出。

## 当前支持规划

### AI Brain
支持接入：

- GPT
- Claude
- Gemini
- DeepSeek
- Grok
- GLM
- Kimi

用于：

- 内容理解
- 剪辑决策
- 镜头规划
- 字幕策略
- 效果选择

### Vision / Image

- Gemini Image API

用于：

- 补充视觉素材
- 信息图
- 背景图
- 概念视觉

### ASR

支持：

- Groq Whisper
- 字级时间戳

用于：

- 精确字幕同步
- 停顿分析
- 节奏判断

### Editing Engine

VectCut API 作为执行层：

- 创建草稿
- 修改草稿
- 添加字幕
- 添加图片/视频层
- 关键帧动画
- 云渲染
- 下载成片

## 核心架构

```
Input Video
    |
    v
ASR + Timestamp
    |
    v
Content Understanding LLM
    |
    v
Editing Plan JSON
    |
    v
VectCut Adapter
    |
    v
Draft -> Review -> Render
```

## 设计原则

1. AI 决策，不套模板
2. 内容优先，特效服务表达
3. 保留人工可编辑能力
4. 支持实体店营销、口播、混剪、信息流广告

## Roadmap

- [x] 项目初始化
- [ ] 多 LLM Provider Adapter
- [ ] ASR Pipeline
- [ ] 剪辑决策 Schema
- [ ] VectCut SDK Adapter
- [ ] 自动审片 Agent
- [ ] Web 控制台

## License

TBD
