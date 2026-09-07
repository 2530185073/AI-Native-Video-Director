import { cuesToSrt } from './subtitles.js';

const END_PUNCTUATION = new Set(Array.from('。！？；;!?.,，、'));
const SKIPPED_CHARS = new Set([
  ' ', '\t', '\n', '\r', '“', '”', '"', "'", '（', '）', '《', '》', '〈', '〉',
  '—', '–', '…', '·', '-', '：', '；', ',', '，', '.', '。', '、', '！', '!', '？', '?', ';'
]);
const CHINESE_NUMERAL_MAP = new Map([
  ['零', '0'], ['一', '1'], ['二', '2'], ['两', '2'], ['三', '3'], ['四', '4'],
  ['五', '5'], ['六', '6'], ['七', '7'], ['八', '8'], ['九', '9']
]);

function normalizeChar(char) {
  return (CHINESE_NUMERAL_MAP.get(char) || char).toLowerCase();
}

export function splitReferenceIntoSentences(text) {
  const sentences = [];
  let buffer = '';
  for (const char of String(text || '')) {
    buffer += char;
    if (END_PUNCTUATION.has(char)) {
      const sentence = buffer.trim();
      if (sentence) sentences.push(sentence);
      buffer = '';
    }
  }
  const remainder = buffer.trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function buildReferenceUnits(sentences) {
  const units = [];
  sentences.forEach((sentence, sentenceIndex) => {
    Array.from(sentence).forEach((char, charIndex) => {
      if (!char.trim() || SKIPPED_CHARS.has(char)) return;
      units.push({ sentenceIndex, charIndex, char, norm: normalizeChar(char) });
    });
  });
  return units;
}

function buildWhisperUnits(words) {
  const units = [];
  if (!Array.isArray(words)) return units;
  words.forEach((rawWord, wordIndex) => {
    const token = String(rawWord?.word ?? rawWord?.text ?? '').trim();
    if (!token) return;
    const startValue = Number(rawWord?.start ?? rawWord?.ts ?? rawWord?.begin ?? 0);
    const endValue = Number(rawWord?.end ?? rawWord?.te ?? rawWord?.finish ?? startValue);
    const start = Number.isFinite(startValue) ? startValue : 0;
    const end = Number.isFinite(endValue) ? Math.max(endValue, start) : start;
    const chars = Array.from(token);
    const duration = Math.max(end - start, 1e-6);
    chars.forEach((char, charIndex) => {
      units.push({
        wordIndex,
        charIndex,
        char,
        norm: normalizeChar(char),
        start: start + duration * charIndex / chars.length,
        end: start + duration * (charIndex + 1) / chars.length
      });
    });
  });
  return units;
}

function computeAlignment(referenceUnits, whisperUnits) {
  const rows = referenceUnits.length;
  const columns = whisperUnits.length;
  if (!rows || !columns) return new Array(rows).fill(null);

  const dp = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
  for (let row = 1; row <= rows; row += 1) dp[row][0] = row;
  for (let column = 1; column <= columns; column += 1) dp[0][column] = column;

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const substitutionCost = referenceUnits[row - 1].norm === whisperUnits[column - 1].norm ? 0 : 1;
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + substitutionCost
      );
    }
  }

  const mapping = new Array(rows).fill(null);
  let row = rows;
  let column = columns;
  while (row > 0 || column > 0) {
    if (row > 0 && dp[row][column] === dp[row - 1][column] + 1) {
      row -= 1;
      continue;
    }
    if (column > 0 && dp[row][column] === dp[row][column - 1] + 1) {
      column -= 1;
      continue;
    }
    if (row > 0 && column > 0) {
      mapping[row - 1] = column - 1;
      row -= 1;
      column -= 1;
    } else {
      break;
    }
  }
  return mapping;
}

function fillMissingTimings(sentences, defaultGap = 0.6) {
  sentences.forEach((sentence, index) => {
    if (sentence.start != null && sentence.end != null && sentence.end > sentence.start) return;
    let previousEnd = null;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (sentences[cursor].end != null) {
        previousEnd = sentences[cursor].end;
        break;
      }
    }
    let nextStart = null;
    for (let cursor = index + 1; cursor < sentences.length; cursor += 1) {
      if (sentences[cursor].start != null) {
        nextStart = sentences[cursor].start;
        break;
      }
    }
    const start = previousEnd ?? 0;
    const end = nextStart != null && nextStart > start ? nextStart : start + defaultGap;
    sentence.start = start;
    sentence.end = Math.max(end, start + 0.2);
  });
}

function ensureMonotonic(sentences) {
  let previousEnd = 0;
  sentences.forEach(sentence => {
    if (sentence.start == null || sentence.end == null) return;
    sentence.start = Math.max(sentence.start, previousEnd);
    sentence.end = Math.max(sentence.end, sentence.start + 0.2);
    previousEnd = sentence.end;
  });
}

function aggregateSentenceTimings(sentences, referenceUnits, whisperUnits, mapping) {
  const timings = Array.from({ length: sentences.length }, () => []);
  const totalChars = new Array(sentences.length).fill(0);
  referenceUnits.forEach(unit => { totalChars[unit.sentenceIndex] += 1; });
  mapping.forEach((whisperIndex, referenceIndex) => {
    if (whisperIndex == null) return;
    const referenceUnit = referenceUnits[referenceIndex];
    const whisperUnit = whisperUnits[whisperIndex];
    if (referenceUnit && whisperUnit) timings[referenceUnit.sentenceIndex].push([whisperUnit.start, whisperUnit.end]);
  });
  return sentences.map((text, index) => {
    const sentenceTimings = timings[index];
    return {
      index: index + 1,
      text,
      start: sentenceTimings.length ? Math.min(...sentenceTimings.map(pair => pair[0])) : null,
      end: sentenceTimings.length ? Math.max(...sentenceTimings.map(pair => pair[1])) : null,
      totalChars: totalChars[index],
      matchedChars: sentenceTimings.length
    };
  });
}

export function alignReferenceWithWhisper(referenceText, whisperWords) {
  const sentences = splitReferenceIntoSentences(referenceText);
  const words = Array.isArray(whisperWords)
    ? whisperWords
    : Array.isArray(whisperWords?.words) ? whisperWords.words : [];
  const referenceUnits = buildReferenceUnits(sentences);
  const whisperUnits = buildWhisperUnits(words);
  const mapping = computeAlignment(referenceUnits, whisperUnits);
  const alignedSentences = aggregateSentenceTimings(sentences, referenceUnits, whisperUnits, mapping);
  fillMissingTimings(alignedSentences);
  ensureMonotonic(alignedSentences);
  return {
    srt: cuesToSrt(alignedSentences),
    sentences: alignedSentences,
    stats: alignedSentences.map(sentence => ({
      index: sentence.index,
      coverage: sentence.totalChars > 0 ? sentence.matchedChars / sentence.totalChars : 1,
      totalChars: sentence.totalChars,
      matchedChars: sentence.matchedChars
    }))
  };
}

export function whisperResponseToSrt(response, referenceText) {
  return alignReferenceWithWhisper(referenceText, response?.words ?? response).srt;
}
