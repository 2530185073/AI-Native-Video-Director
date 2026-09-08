import { parseSrt } from '../asr/subtitles.js';

const TEXT_KEYS = ['word', 'text', 'char', 'character', 'token', 'content'];
const START_KEYS = ['start', 'start_time', 'startTime', 'begin', 'begin_time', 'ts', 'from', 'st'];
const END_KEYS = ['end', 'end_time', 'endTime', 'finish', 'te', 'to', 'ed'];

function pick(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function toSeconds(value, unitHint) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?[,.]\d{1,3}$/.test(value.trim())) {
    const [cue] = parseSrt(`1\n${value} --> ${value}\nx\n`);
    return cue ? cue.start : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (unitHint === 'ms') return number / 1000;
  return number;
}

function looksLikeWord(item) {
  return item && typeof item === 'object' && pick(item, START_KEYS) !== undefined && pick(item, TEXT_KEYS) !== undefined;
}

/** Depth-first search for the first array that looks like a list of timed words. */
function findWordArray(node, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length && node.every(looksLikeWord)) return node;
    for (const item of node) {
      const found = findWordArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const preferred = ['words', 'characters', 'chars', 'tokens', 'items', 'result', 'results', 'data', 'output', 'segments'];
  for (const key of preferred) {
    if (node[key] !== undefined) {
      const found = findWordArray(node[key], depth + 1);
      if (found) return found;
    }
  }
  for (const value of Object.values(node)) {
    const found = findWordArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function detectUnit(items) {
  const values = items.flatMap(item => [pick(item, START_KEYS), pick(item, END_KEYS)])
    .filter(value => value !== undefined && value !== null && typeof value !== 'string' || /^\d+(\.\d+)?$/.test(String(value)))
    .map(Number)
    .filter(Number.isFinite);
  if (!values.length) return 's';
  const max = Math.max(...values);
  // Beyond ~4h the numbers cannot be seconds of speech.
  if (max > 4 * 3600) return 'ms';
  // Word-level timestamps in seconds are never all integers; all-integer values
  // reaching into the hundreds are milliseconds from a short clip.
  const allIntegers = values.every(Number.isInteger);
  if (allIntegers && max >= 200) return 'ms';
  return 's';
}

/**
 * Normalize any reasonable ASR payload into `[{ text, start, end }]` sorted by start.
 *
 * Accepted shapes:
 * - `[{ word|text|char, start, end }]`
 * - `{ words: [...] }`, `{ data: { characters: [...] } }`, Groq/Whisper verbose_json, etc.
 * - an SRT string (each cue becomes one "word")
 * - `{ srt: '...' }`
 * Times may be seconds, milliseconds (auto-detected) or `HH:MM:SS,mmm` strings.
 */
export function normalizeWords(input, { timeUnit } = {}) {
  if (!input) return [];
  if (typeof input === 'string') {
    return parseSrt(input).map(cue => ({ text: cue.text, start: cue.start, end: cue.end }));
  }
  const array = Array.isArray(input) && input.every(looksLikeWord) ? input : findWordArray(input);
  if (!array) {
    if (typeof input.srt === 'string') return normalizeWords(input.srt);
    return [];
  }
  const unit = timeUnit || detectUnit(array);
  const words = [];
  for (const item of array) {
    const text = String(pick(item, TEXT_KEYS) ?? '').trim();
    if (!text) continue;
    const start = toSeconds(pick(item, START_KEYS), unit);
    if (start === null) continue;
    let end = toSeconds(pick(item, END_KEYS), unit);
    if (end === null) {
      const duration = toSeconds(pick(item, ['duration', 'dur']), unit);
      end = duration !== null ? start + duration : start;
    }
    words.push({ text, start: Math.max(0, start), end: Math.max(start, end) });
  }
  words.sort((left, right) => left.start - right.start);
  return words;
}

export function wordsDuration(words) {
  return (words || []).reduce((max, word) => Math.max(max, Number(word.end) || 0), 0);
}
