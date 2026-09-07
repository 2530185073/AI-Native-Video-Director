# AI-Native-Video-Director

> AI 原生短视频导演系统（AI Video Director）。
>
> 不是固定模板剪辑，而是让 AI 理解内容、理解观众、理解画面，并自主决定如何完成口播、混剪、信息流广告视频生产。

---

## 项目定位

传统 AI 剪辑工具主要解决：

- 自动加字幕
- 自动套模板
- 自动切片
- 自动生成简单包装

本项目目标是构建一个 **AI 视频导演 Agent**。

AI 不只是执行剪辑动作，而是完成导演工作：

- 判断哪里应该保留人物表达
- 判断哪里应该展示商品或案例
- 判断哪些关键词值得强调
- 判断什么时候需要图片解释
- 判断什么时候需要局部放大
- 判断什么时候需要节奏变化
- 判断什么时候应该保持干净，不添加任何效果

最终输出：

```
原始视频
    ↓
AI理解内容
    ↓
生成剪辑方案
    ↓
调用剪辑引擎
    ↓
生成可编辑草稿
    ↓
云渲染成片
```

---

# 核心能力

## 1. Multi LLM AI Brain

支持接入：

- GPT
- Claude
- Gemini
- DeepSeek
- Grok
- GLM
- Kimi

不同模型承担不同角色：

| 模型 | 方向 |
|-|-|
| GPT | 总导演、综合决策 |
| Claude | 长视频理解、复杂规划 |
| Gemini | 视频视觉理解、生图 |
| DeepSeek | 低成本批量任务 |
| Kimi | 中文长内容理解 |
| Grok | 热点、网感分析 |
| GLM | 国产生态适配 |

---

# 2. ASR 视频理解层

基于：

- Groq Whisper
- word level timestamp
- 字符级文本对齐

能力：

- 精确字幕同步
- 口播文案校正
- 气口检测
- 停顿压缩
- 时间轴重映射

流程：

```
Whisper
 ↓
词级时间戳
 ↓
字符级 Alignment
 ↓
字幕结构化
 ↓
剪辑时间轴
```

代码：

```
src/asr/
```

---

# 3. AI Director 决策系统

核心不是模板，而是生成 Editing Plan。

例如：

```json
{
 "scene":"产品细节解释",
 "keep_person":false,
 "visual":"product_zoom",
 "subtitle_highlight":["一万左右"],
 "motion":"zoom_in"
}
```

AI 负责决定：

- 镜头语言
- 字幕策略
- 视觉补充
- 动效选择
- 节奏变化

---

# 4. Gemini Image Vision

用于：

## Vision

分析：

- 人物位置
- 商品位置
- 空白区域
- 可放文字区域
- 视觉重点

## Image Generation

生成：

- 信息图
- 背景视觉
- 概念素材
- 营销辅助图片

---

# 5. VectCut Editing Engine

VectCut 作为执行层。

负责：

- 创建草稿
- 添加字幕
- 添加图片
- 添加视频轨
- 关键帧动画
- 修改草稿
- 云渲染
- 输出成片

架构：

```
AI Editing Plan
        ↓
VectCut Adapter
        ↓
Draft
        ↓
Render
```

---

# 支持场景

## 口播视频

例如：

- 知识分享
- 商品讲解
- 专业领域内容

## 混剪视频

例如：

- 产品营销
- 案例展示
- 热点内容

## 信息流广告

例如：

- 抖音广告
- 视频号广告
- 小红书内容

---

# 项目架构

```
src/

├── asr/
│   └── Whisper + Alignment
│
├── agent/
│   └── AI Director
│
├── providers/
│   └── LLM Providers
│
├── vision/
│   └── Gemini Vision/Image
│
├── schemas/
│   └── Editing Plan
│
├── editing/
│   └── VectCut Adapter
│
└── core/
    └── Pipeline
```

---

# 开发路线图

## Phase 1 - MVP（当前目标）

目标：

> 一条口播视频自动生成 VectCut 可编辑草稿。

完成：

- [x] 项目初始化
- [x] ASR Pipeline
- [x] 字幕时间轴系统
- [x] Editing Plan Schema
- [x] AI Director 基础流程

开发中：

- [ ] LLM Provider
- [ ] Gemini Vision
- [ ] VectCut 真执行接口
- [ ] 自动生成第一版草稿

---

## Phase 2 - AI 剪辑师

增加：

- 多模型协作
- 自动素材搜索
- 自动生图
- 自动字幕包装
- 自动节奏控制

---

## Phase 3 - 自动审片 Agent

AI 生成视频后自动检查：

- 字幕是否错误
- 节奏是否拖沓
- 重点是否突出
- 画面是否遮挡
- 是否符合平台风格

然后自动修改。

---

## Phase 4 - 商业化平台

目标：

提供：

- 企业账号
- 行业模板能力
- 素材资产库
- AI 视频生产流水线

---

# 设计原则

1. AI 决策，不套固定模板
2. 内容优先，特效服务表达
3. 保留可编辑能力
4. 支持真实商业生产
5. AI 作为导演，而不是工具人

---

# License

TBD
