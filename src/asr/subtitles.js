const COMMON_PUNCTUATION = new Set([
  ' ', '\t', '\n', '\r', '“', '”', '"', "'", '（', '）', '《', '》', '〈', '〉',
  '—', '–', '…', '·', '-', '：', '；', ',', '，', '.', '。', '、', '！', '!', '？', '?', ';'
]);

function parseTimeToSeconds(value) {
  const match = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(String(value || '').trim());
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const millis = Number(match[4] || 0);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatSecondsToTime(value) {
  const secondsValue = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const totalMillis = Math.round(secondsValue * 1000);
  const millis = totalMillis % 1000;
  const totalSeconds = Math.floor(totalMillis / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function parseSrt(srt) {
  const blocks = String(srt || '').replace(/\r/g, '').split(/\n\s*\n/).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let index = 0;
    let cursor = 0;
    if (/^\d+$/.test(lines[0]?.trim())) {
      index = Number(lines[0].trim());
      cursor = 1;
    }
    const timeLine = lines[cursor++] || '';
    const [startRaw, endRaw] = timeLine.split('-->').map(part => part.trim());
    const start = parseTimeToSeconds(startRaw);
    const parsedEnd = parseTimeToSeconds(endRaw);
    const end = Math.max(parsedEnd, start + 0.1);
    const text = lines.slice(cursor).join(' ').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ index, start, end, text });
  }
  return cues;
}

export function cuesToSrt(cues = []) {
  return cues.map((cue, index) => {
    const start = Number(cue.start) || 0;
    const end = Math.max(Number(cue.end) || 0, start + 0.1);
    return `${index + 1}\n${formatSecondsToTime(start)} --> ${formatSecondsToTime(end)}\n${String(cue.text || '').trim()}\n`;
  }).join('\n');
}

export function sanitizeCues(cues, { minDuration = 0.1 } = {}) {
  if (!Array.isArray(cues)) return [];
  const output = [];
  let previousEnd = 0;
  for (const cue of cues) {
    const text = String(cue?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let start = Number(cue?.start);
    let end = Number(cue?.end);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = start;
    start = Math.max(start, previousEnd);
    end = Math.max(end, start + minDuration);
    output.push({ ...cue, start, end, text });
    previousEnd = end;
  }
  return output;
}

export function sanitizeSrt(srt, options) {
  return cuesToSrt(sanitizeCues(parseSrt(srt), options));
}

export function stripPunctuation(text) {
  return Array.from(String(text || '')).filter(char => !COMMON_PUNCTUATION.has(char)).join('');
}

export function stripPunctuationFromSrt(srt) {
  const cues = parseSrt(srt)
    .map(cue => ({ ...cue, text: stripPunctuation(cue.text).replace(/\s+/g, ' ').trim() }))
    .filter(cue => cue.text);
  return cuesToSrt(sanitizeCues(cues));
}

function normalizePlainText(plainText) {
  return String(plainText || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergePlainTextIntoCues(cues, plainText) {
  if (!Array.isArray(cues) || !cues.length) return [];
  const normalized = normalizePlainText(plainText);
  if (!normalized) return cues;

  const pool = Array.from(normalized);
  const targetLengths = cues.map(cue => {
    const compact = String(cue.text || '').replace(/\s+/g, '');
    return Math.max(1, compact.length || 1);
  });
  const boundary = new Set([' ', '\t', '\n', '\r', ',', '，', '.', '。', '！', '!', '?', '？', ';', '；', ':', '：']);
  let remainingTarget = targetLengths.reduce((sum, value) => sum + value, 0) || 1;
  let remainingChars = pool.length;
  const output = [];

  const takePortion = (desired, cueIndex) => {
    if (!pool.length) return '';
    const remainingSlots = cues.length - cueIndex;
    const minNeeded = Math.max(remainingSlots - 1, 0);
    let count = Math.min(desired, pool.length - minNeeded);
    if (count <= 0) count = Math.min(desired, pool.length);
    const chunk = [];
    while (count-- > 0 && pool.length) chunk.push(pool.shift());
    while (
      pool.length && chunk.length &&
      !boundary.has(pool[0]) && !boundary.has(chunk[chunk.length - 1])
    ) chunk.push(pool.shift());
    return chunk.join('').trim();
  };

  for (let index = 0; index < cues.length; index += 1) {
    const target = targetLengths[index];
    const proportion = target / remainingTarget;
    const desired = index === cues.length - 1
      ? pool.length
      : Math.max(1, Math.round(remainingChars * proportion));
    let text = index === cues.length - 1 ? pool.splice(0).join('').trim() : takePortion(desired, index);
    if (!text) text = String(cues[index].text || '').trim();
    text = text.replace(/\s+/g, ' ').replace(/\s+([，。！？；：])/g, '$1').trim();
    output.push({ ...cues[index], text });
    remainingTarget -= target;
    remainingChars = pool.length;
  }
  return sanitizeCues(output);
}

export function mergePlainTextIntoSrt({ srt, plainText }) {
  if (!plainText) return srt;
  return cuesToSrt(mergePlainTextIntoCues(parseSrt(srt), plainText));
}

export function segmentsToSrt(segments = []) {
  return cuesToSrt(segments.map((segment, index) => ({
    index: index + 1,
    start: Number(segment.start) || 0,
    end: Number(segment.end) || Number(segment.start) || 0,
    text: String(segment.text || '').trim()
  })));
}
