import { alignScriptCharacters } from '../asr/alignment.js';

const HARD_BREAKS = new Set(Array.from('。！？；!?;\n'));
const SOFT_BREAKS = new Set(Array.from(',，、：:…—'));
const STRIP_CHARS = new Set(Array.from(' \t\r\n“”"\'（）《》〈〉—–…·-：；,，.。、！!？?;:「」『』【】[]()'));

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Split the aligned character list into sentence ranges. Every range ends right
 * after a hard or soft punctuation mark so the AI sees natural phrase borders.
 */
function splitSentences(characters) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const char = characters[index].char;
    if (HARD_BREAKS.has(char) || SOFT_BREAKS.has(char)) {
      ranges.push([start, index + 1]);
      start = index + 1;
    }
  }
  if (start < characters.length) ranges.push([start, characters.length]);
  return ranges.filter(([from, to]) => characters.slice(from, to).some(entry => entry.alignable));
}

const isDigit = char => /[0-9]/.test(char || '');

/**
 * Characters that end up on screen: everything alignable minus punctuation, plus
 * decimal points that sit between digits ("26.8" must not become "268").
 */
function displayChars(entries) {
  return entries.filter((entry, index) => {
    if (entry.alignable && !STRIP_CHARS.has(entry.char)) return true;
    if (entry.char === '.' && isDigit(entries[index - 1]?.char) && isDigit(entries[index + 1]?.char)) return true;
    return false;
  });
}

/**
 * Recursively split a phrase that is too long for one subtitle line. Prefer the
 * largest silence between two characters; fall back to the most balanced cut.
 */
function splitLong(entries, { maxChars, minChars, pauseGap }) {
  const visible = displayChars(entries);
  if (visible.length <= maxChars) return [entries];

  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = minChars; index <= visible.length - minChars; index += 1) {
    const previous = visible[index - 1];
    const current = visible[index];
    const gap = previous.end != null && current.start != null ? current.start - previous.end : 0;
    const balance = 1 - Math.abs(index - visible.length / 2) / (visible.length / 2);
    const score = (gap > pauseGap ? 10 + gap : gap) + balance;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return [entries];

  const cutEntry = visible[bestIndex];
  const cutPosition = entries.indexOf(cutEntry);
  const left = entries.slice(0, cutPosition);
  const right = entries.slice(cutPosition);
  return [...splitLong(left, { maxChars, minChars, pauseGap }), ...splitLong(right, { maxChars, minChars, pauseGap })];
}

function splitOnPauses(entries, { minChars, pauseGap }) {
  const visible = displayChars(entries);
  const pieces = [];
  let pieceStart = 0;
  let lastCut = 0;
  for (let index = 1; index < visible.length; index += 1) {
    const previous = visible[index - 1];
    const current = visible[index];
    if (previous.end == null || current.start == null) continue;
    const gap = current.start - previous.end;
    if (gap > pauseGap && index - lastCut >= minChars && visible.length - index >= minChars) {
      const cutPosition = entries.indexOf(current);
      pieces.push(entries.slice(pieceStart, cutPosition));
      pieceStart = cutPosition;
      lastCut = index;
    }
  }
  pieces.push(entries.slice(pieceStart));
  return pieces.filter(piece => displayChars(piece).length);
}

function timingOf(entries) {
  const timed = entries.filter(entry => entry.alignable && entry.start != null);
  if (!timed.length) return { start: null, end: null, matched: 0 };
  return {
    start: Math.min(...timed.map(entry => entry.start)),
    end: Math.max(...timed.map(entry => entry.end)),
    matched: timed.length
  };
}

function fillMissing(chunks, totalDuration) {
  chunks.forEach((chunk, index) => {
    if (chunk.start != null && chunk.end != null) return;
    let previousEnd = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (chunks[cursor].end != null) { previousEnd = chunks[cursor].end; break; }
    }
    let nextStart = null;
    let span = chunk.text.length;
    for (let cursor = index + 1; cursor < chunks.length; cursor += 1) {
      span += chunks[cursor].text.length;
      if (chunks[cursor].start != null) { nextStart = chunks[cursor].start; break; }
    }
    if (nextStart == null) nextStart = totalDuration && totalDuration > previousEnd ? totalDuration : previousEnd + 0.35 * chunk.text.length;
    const share = (nextStart - previousEnd) * (chunk.text.length / Math.max(span, 1));
    chunk.start = previousEnd;
    chunk.end = previousEnd + Math.max(share, 0.3);
    chunk.interpolated = true;
  });
}

function polish(chunks, { minDuration, holdGap, totalDuration }) {
  let previousEnd = 0;
  chunks.forEach((chunk, index) => {
    chunk.start = Math.max(chunk.start, previousEnd);
    chunk.end = Math.max(chunk.end, chunk.start + minDuration);
    const next = chunks[index + 1];
    if (next && next.start != null) {
      const gap = next.start - chunk.end;
      // Hold the line on screen through short silences so subtitles do not flicker.
      if (gap > 0 && gap < holdGap) chunk.end = next.start - 0.02;
      if (chunk.end > next.start) chunk.end = Math.max(chunk.start + 0.15, next.start - 0.02);
    } else if (totalDuration && chunk.end > totalDuration) {
      chunk.end = Math.max(chunk.start + 0.15, totalDuration);
    }
    chunk.start = round(chunk.start);
    chunk.end = round(chunk.end);
    previousEnd = chunk.end;
  });
}

/**
 * Turn a script plus word timestamps into short, screen-ready subtitle chunks.
 *
 * Each chunk carries per-character timing so callers can locate the exact moment
 * a keyword is spoken (used for punch-in text and zoom beats).
 */
export function buildChunks({
  script,
  words,
  maxChars = 14,
  minChars = 3,
  pauseGap = 0.35,
  minDuration = 0.4,
  holdGap = 0.6,
  totalDuration = null
} = {}) {
  if (!script || !String(script).trim()) throw new Error('script is required to build subtitle chunks');
  const alignment = alignScriptCharacters(script, words || []);
  const characters = alignment.characters;

  const pieces = [];
  for (const [from, to] of splitSentences(characters)) {
    const sentence = characters.slice(from, to);
    for (const pausePiece of splitOnPauses(sentence, { minChars, pauseGap })) {
      pieces.push(...splitLong(pausePiece, { maxChars, minChars, pauseGap }));
    }
  }

  const chunks = pieces.map(entries => {
    const visible = displayChars(entries);
    const timing = timingOf(visible);
    return {
      id: 0,
      text: visible.map(entry => entry.char).join(''),
      raw: entries.map(entry => entry.char).join('').trim(),
      start: timing.start,
      end: timing.end,
      coverage: visible.length ? timing.matched / visible.length : 0,
      chars: visible.map(entry => ({ char: entry.char, start: entry.start, end: entry.end }))
    };
  }).filter(chunk => chunk.text);

  fillMissing(chunks, totalDuration);
  polish(chunks, { minDuration, holdGap, totalDuration });
  chunks.forEach((chunk, index) => {
    chunk.id = index + 1;
    chunk.chars.forEach((char, position) => {
      if (char.start != null) return;
      const previous = chunk.chars[position - 1];
      const next = chunk.chars.slice(position + 1).find(entry => entry.start != null);
      char.start = previous?.end ?? chunk.start;
      char.end = next?.start ?? chunk.end;
      if (char.end < char.start) char.end = char.start;
    });
  });

  return {
    chunks,
    coverage: alignment.coverage,
    duration: totalDuration || (chunks.length ? chunks[chunks.length - 1].end : 0)
  };
}

/**
 * Locate when a phrase inside a chunk is spoken. Falls back to the chunk range
 * when the phrase is not a substring (the AI occasionally paraphrases).
 */
export function phraseTiming(chunk, phrase) {
  const target = String(phrase || '').replace(/\s+/g, '');
  const text = chunk.text;
  const index = target ? text.indexOf(target) : -1;
  if (index < 0 || !chunk.chars?.length) return { start: chunk.start, end: chunk.end, exact: false };
  const slice = chunk.chars.slice(index, index + Array.from(target).length);
  const start = Math.min(...slice.map(char => char.start ?? chunk.start));
  const end = Math.max(...slice.map(char => char.end ?? chunk.end));
  return { start: round(start), end: round(Math.max(end, start + 0.2)), exact: true, charStart: index, charEnd: index + Array.from(target).length };
}

export function chunkRange(chunks, fromId, toId) {
  const from = chunks.find(chunk => chunk.id === fromId);
  const to = chunks.find(chunk => chunk.id === (toId ?? fromId));
  if (!from || !to) return null;
  return { start: Math.min(from.start, to.start), end: Math.max(from.end, to.end) };
}
