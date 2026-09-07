# AI Video Editing System Architecture

## Modules

## 1. Input Layer

Inputs:

- Raw talking-head video
- Original script
- ASR word timestamps
- Brand requirements
- Business assets

## 2. ASR Layer

The ASR pipeline is implemented in `src/asr/` and is deliberately independent
from the LLM and VectCut adapters.

### Recognition

`transcribeWithGroq()` downloads the input media and calls the OpenAI-compatible
Groq endpoint:

```text
POST ${GROQ_WHISPER_URL}
model=whisper-large-v3
response_format=verbose_json
timestamp_granularities[]=word
```

The returned `words[]` (`word`, `start`, `end`) are the single source of truth
for subtitle timing and pause detection.

### Reference-text alignment

`alignReferenceWithWhisper()` splits the reviewed script by punctuation, expands
the script and ASR tokens into characters, linearly distributes a word's time
over its characters, and aligns both character sequences with Levenshtein
dynamic programming. Each sentence receives the minimum start and maximum end
of its mapped characters. Missing timings are filled and the result is made
monotonic before SRT serialization.

This is text-level ASR timestamp alignment, not an acoustic forced-aligner.

### Debreath / pause compression

`planDebreath()` examines gaps between adjacent ASR words. A gap greater than
`ASR_DEBREATH_THRESHOLD` (default `0.4s`) is shortened to
`ASR_DEBREATH_KEEP_GAP` (default `0.15s`). It returns retained source segments,
their target positions, the new duration, and an original-to-new time mapper.

`processAsrSubtitles()` applies that mapper to the final SRT. The editing layer
should use the returned `debreath.timeline` for segmented video insertion and
the remapped `pipelineSrt` for subtitle insertion.

### Pipeline output

The pipeline returns the raw transcription, original/optimized/aligned/final
SRT variants, alignment statistics, and debreath metadata. If word timestamps
are unavailable, alignment and debreath are skipped and the available SRT is
used as a safe fallback.

## 3. Intelligence Layer

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

## 4. Asset Layer

Sources:

- User uploaded assets
- Gemini image generation
- Business knowledge base

## 5. Execution Layer

VectCut adapter converts editing plan into timeline operations.

## 6. Review Layer

Future:

- Render preview
- AI quality check
- Human feedback loop

## Goal

Build an autonomous AI editor that creates internet-native short videos while preserving professional editing control.
