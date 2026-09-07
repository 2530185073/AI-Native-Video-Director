# AI-Native-Video-Director 项目详细规划

## 1. 项目愿景

构建一个 AI 原生的视频生产系统，让 AI 从剪辑工具升级为视频导演。

系统目标：

输入：

- 原始口播视频
- 原始文案
- ASR 时间戳
- 素材库
- 品牌要求

输出：

- AI 剪辑方案
- VectCut 可编辑草稿
- 云渲染视频

核心理念：

不是模板驱动，而是内容驱动。

---

## 2. 为什么需要 AI Director

传统自动剪辑：

```
关键词
 ↓
固定模板
 ↓
生成视频
```

问题：

- 不理解内容
- 不知道重点
- 所有视频风格相同

AI Director：

```
理解内容
 ↓
理解观众
 ↓
制定表达策略
 ↓
执行剪辑
```

---

## 3. 系统模块

## Content Understanding

负责理解：

- 文案结构
- 情绪变化
- 信息密度
- 营销目标

输出：

Content Map。

---

## AI Director

负责：

- 镜头规划
- 字幕策略
- 视觉选择
- 节奏控制

输出：

Editing Plan。

---

## Vision System

使用 Gemini Vision。

分析：

- 人物位置
- 商品位置
- 场景结构
- 可视区域

辅助 AI 决策。

---

## Asset Intelligence

未来建设：

素材知识库。

每个素材包含：

- 类型
- 标签
- 适用场景
- 使用权限
- 视觉描述

---

## Editing Execution

VectCut 负责：

- 时间线生成
- 字幕
- 图片
- 视频层
- 动效
- 渲染

---

# MVP 开发计划

## 第一阶段

目标：

一条视频自动生成草稿。

流程：

```
Upload Video
 ↓
Whisper ASR
 ↓
Alignment
 ↓
LLM Director
 ↓
Editing Plan
 ↓
VectCut Draft
```

---

## 第二阶段

增强 AI 能力：

- 多模型协作
- 图片生成
- 视频理解
- 自动素材选择

---

## 第三阶段

加入审片 Agent：

生成 → 查看 → 修改 → 再生成。

形成闭环。

---

# 商业方向

重点行业：

- 实体店
- 电商
- 知识付费
- 企业营销

目标：

让普通企业拥有 AI 视频团队。

---

# 长期目标

成为 AI Native Video Operating System。

让视频生产从：

人工剪辑流程

升级为：

AI 导演 + AI 剪辑 + AI 审核。
