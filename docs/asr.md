# ASR 字幕处理模块

## 目标

把一段口播音频/视频和人工校对文案转换为可用于剪辑的字幕时间轴，并
根据词间停顿生成视频时间轴压缩方案。

## 入口

```js
import { processAsrSubtitles } from '../src/asr/index.js';

const output = await processAsrSubtitles({
  audioUrl,
  referenceText,
  language: 'zh',
  alignmentEnabled: true,
  debreathEnabled: true,
  debreathThreshold: 0.4,
  debreathKeepGap: 0.15
});
```

也可以传入已经获得的 `transcription`，用于测试或接入其他 ASR Provider：

```js
const output = await processAsrSubtitles({
  referenceText,
  transcription: {
    duration: 12.4,
    words: [{ word: '你好', start: 0, end: 0.5 }],
    srt: '1\n00:00:00,000 --> 00:00:00,500\n你好\n'
  }
});
```

## Whisper 接口

默认调用：

```text
POST https://api.groq.com/openai/v1/audio/transcriptions
```

可通过 `GROQ_WHISPER_URL` 覆盖。请求为 multipart/form-data：

```text
file=<下载后的媒体文件>
model=whisper-large-v3
response_format=verbose_json
language=zh
timestamp_granularities[]=word
prompt=<可选的参考文案>
```

需要 `GROQ_API_KEY`。返回中的 `words` 是对齐和气口剪辑的输入。

## 对齐方案

1. 参考文案按句号、逗号、问号等标点切句。
2. 参考文案和 Whisper 词分别展开为字符序列。
3. 一个 Whisper 词的时间区间按字符数均匀切分。
4. 用 Levenshtein 动态规划匹配两个字符序列：相同字符代价为 0，替换/插入/删除代价为 1。
5. 每个参考句子的开始时间取匹配字符的最小 start，结束时间取最大 end。
6. 对缺失时间进行补齐，并保证字幕时间单调递增。

输出字段：

- `transcriptionSrt`：ASR 原始 SRT
- `optimizedSrt`：参考文案合并到原始字幕时间段后的 SRT
- `alignedSrt`：字符级对齐后的 SRT
- `finalSrt`：最终未去标点的 SRT
- `finalSrtNoPunct`：去掉标点的 SRT
- `alignmentStats`：每句字符映射覆盖率

## 去气口方案

`planDebreath()` 使用相邻词的时间间隔判断停顿：

```text
gap = currentWord.start - previousWord.end
```

当 `gap > 0.4s` 时，默认只保留 `0.15s`，删除其余停顿。开头和结尾的
长空白也会处理。

返回的 `debreath.timeline` 结构如下：

```json
[
  { "srcStart": 0, "srcEnd": 3.35, "targetStart": 0 },
  { "srcStart": 4, "srcEnd": 8, "targetStart": 3.35 }
]
```

编辑引擎应该：

1. 按 `srcStart/srcEnd/targetStart` 分段添加原视频。
2. 使用 `pipelineSrt` 添加已经重映射的字幕。
3. 使用 `debreath.newDuration` 作为背景音乐或其他全片轨道的新时长。

如果没有 `words` 或无法得到音频时长，则不会剪气口，原视频和原时间轴保持不变。

## 环境变量

```ini
GROQ_API_KEY=
GROQ_WHISPER_URL=https://api.groq.com/openai/v1/audio/transcriptions
GROQ_WHISPER_MODEL=whisper-large-v3
ASR_ALIGNMENT_ENABLED=true
ASR_DEBREATH_ENABLED=true
ASR_DEBREATH_THRESHOLD=0.4
ASR_DEBREATH_KEEP_GAP=0.15
```

## 限制

这是基于 ASR 词级时间戳的文本对齐，不是声学模型级的逐字 forced alignment。
Whisper 词内字符时间采用均匀插值，适合作为短视频字幕和节奏剪辑时间轴，
但不应被理解为真实的声学逐字边界。
