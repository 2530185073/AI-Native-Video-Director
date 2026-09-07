# AI Video Editing System Architecture

## Modules

## 1. Input Layer

Inputs:

- Raw talking-head video
- Original script
- ASR word timestamps
- Brand requirements
- Business assets

## 2. Intelligence Layer

LLM analyzes:

- Topic structure
- Emotional peaks
- Information density
- Visual requirements
- CTA moments

Output:

```json
{
  "scene": "explain_detail",
  "time": "00:12-00:18",
  "visual": "product_closeup",
  "subtitle": {
    "highlight": ["核心关键词"]
  },
  "motion": "zoom_in"
}
```

## 3. Asset Layer

Sources:

- User uploaded assets
- Gemini image generation
- Business knowledge base

## 4. Execution Layer

VectCut adapter converts editing plan into timeline operations.

## 5. Review Layer

Future:

- Render preview
- AI quality check
- Human feedback loop

## Goal

Build an autonomous AI editor that creates internet-native short videos while preserving professional editing control.
