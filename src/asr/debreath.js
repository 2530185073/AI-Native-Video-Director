import { cuesToSrt, parseSrt, sanitizeCues } from './subtitles.js';

export function planDebreath({ words, totalDuration, threshold = 0.4, keepGap = 0.15 } = {}) {
  const sortedWords = (words || [])
    .map(word => ({
      start: Number(word?.start ?? word?.ts ?? word?.begin ?? 0),
      end: Number(word?.end ?? word?.te ?? word?.finish ?? 0)
    }))
    .filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start)
    .sort((left, right) => left.start - right.start);
  if (!sortedWords.length) return null;

  const duration = Number(totalDuration) > 0 ? Number(totalDuration) : sortedWords[sortedWords.length - 1].end;
  const round = value => Math.round(value * 1000) / 1000;
  const deletions = [];

  if (sortedWords[0].start > keepGap + threshold) {
    deletions.push({ start: keepGap, end: sortedWords[0].start });
  }
  for (let index = 1; index < sortedWords.length; index += 1) {
    const previous = sortedWords[index - 1];
    const current = sortedWords[index];
    const gap = current.start - previous.end;
    if (gap <= threshold) continue;
    const start = previous.end + keepGap;
    const end = current.start;
    if (end - start > 0.05) deletions.push({ start, end });
  }
  const lastEnd = sortedWords[sortedWords.length - 1].end;
  if (duration - lastEnd > keepGap + threshold) {
    deletions.push({ start: lastEnd + keepGap, end: duration });
  }

  deletions.sort((left, right) => left.start - right.start);
  const segments = [];
  let cursor = 0;
  let target = 0;
  for (const deletion of deletions) {
    if (deletion.start > cursor) {
      const srcStart = round(cursor);
      const srcEnd = round(deletion.start);
      segments.push({ srcStart, srcEnd, targetStart: round(target) });
      target += srcEnd - srcStart;
    }
    cursor = Math.max(cursor, deletion.end);
  }
  if (cursor < duration) {
    const srcStart = round(cursor);
    const srcEnd = round(duration);
    segments.push({ srcStart, srcEnd, targetStart: round(target) });
    target += srcEnd - srcStart;
  }
  if (!segments.length) return null;

  const newDuration = round(target);
  const remap = value => {
    const time = Number(value) || 0;
    for (const segment of segments) {
      if (time < segment.srcStart) return segment.targetStart;
      if (time <= segment.srcEnd) return round(segment.targetStart + time - segment.srcStart);
    }
    return newDuration;
  };
  return {
    segments,
    newDuration,
    removed: round(duration - newDuration),
    remap
  };
}

export function remapCues(cues, plan) {
  if (!plan) return sanitizeCues(cues);
  return sanitizeCues((cues || []).map(cue => {
    const start = plan.remap(cue.start);
    const end = Math.max(plan.remap(cue.end), start + 0.3);
    return { ...cue, start, end };
  }));
}

export function remapSrt(srt, plan) {
  return cuesToSrt(remapCues(parseSrt(srt), plan));
}
