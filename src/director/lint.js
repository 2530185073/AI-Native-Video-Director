import { chunkRange } from '../timeline/chunker.js';

export const DEFAULT_LIMITS = {
  punchPerMinute: 8,
  brollPerMinute: 4,
  effectPerMinute: 3,
  maxZoomSeconds: 8,
  minBrollSeconds: 1.2,
  maxBrollSeconds: 6,
  maxEffectSeconds: 4
};

function beatRange(beat, chunks) {
  if (beat.type === 'punch') return chunkRange(chunks, beat.chunkId, beat.chunkId);
  return chunkRange(chunks, beat.fromChunk, beat.toChunk);
}

function overlaps(a, b) {
  return a && b && a.start < b.end && b.start < a.end;
}

function capDensity(beats, type, perMinute, durationSec, warnings) {
  const allowed = Math.max(1, Math.round((perMinute * Math.max(durationSec, 15)) / 60));
  const ofType = beats.filter(beat => beat.type === type);
  if (ofType.length <= allowed) return beats;
  // Keep an even spread across the video instead of the first N.
  const step = ofType.length / allowed;
  const keep = new Set();
  for (let index = 0; index < allowed; index += 1) keep.add(ofType[Math.floor(index * step)]);
  warnings.push(`${type}: ${ofType.length} beats exceed the ${allowed} allowed for a ${Math.round(durationSec)}s video; thinned to keep rhythm breathable`);
  return beats.filter(beat => beat.type !== type || keep.has(beat));
}

/**
 * Rule-based review of an editing plan before it is compiled.
 *
 * The AI decides *what* to do; these rules protect the viewer experience against
 * the failure modes an LLM cannot see: covering the face, effect fatigue, overlapping
 * B-roll, highlights that are not actually in the subtitle, etc. Every fix is
 * reported so it can be fed back to the model or shown to the operator.
 */
export function lintPlan(plan, { chunks, layout, duration, limits = DEFAULT_LIMITS } = {}) {
  const warnings = [];
  const result = structuredClone(plan);
  const chunkById = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const totalDuration = duration || (chunks.length ? chunks[chunks.length - 1].end : 60);

  // 1. Highlights must literally appear in the subtitle chunk.
  result.chunks = result.chunks.filter(entry => chunkById.has(entry.id));
  for (const entry of result.chunks) {
    const text = chunkById.get(entry.id).text;
    const valid = [];
    for (const word of entry.highlights || []) {
      const clean = String(word).replace(/\s+/g, '');
      if (clean && text.includes(clean)) valid.push(clean);
      else warnings.push(`chunk ${entry.id}: highlight "${word}" is not in "${text}", dropped`);
    }
    entry.highlights = [...new Set(valid)];
  }

  // 2. Subtitle position must not sit on the face.
  if (layout) {
    const placement = layout.subtitle(result.subtitleStyle.position);
    if (layout.overlapsFace(placement.yFraction, 0.08)) {
      warnings.push(`subtitle position "${result.subtitleStyle.position}" overlaps the face; switched to lower_third`);
      result.subtitleStyle.position = 'lower_third';
    }
  }

  // 3. Resolve ranges, drop beats that point at nothing, clamp durations.
  let beats = [];
  for (const beat of result.beats) {
    const range = beatRange(beat, chunks);
    if (!range) {
      warnings.push(`${beat.type} beat references unknown chunks, dropped`);
      continue;
    }
    const length = range.end - range.start;
    if (beat.type === 'zoom' && length > limits.maxZoomSeconds) {
      warnings.push(`zoom ${beat.fromChunk}-${beat.toChunk} lasts ${length.toFixed(1)}s (> ${limits.maxZoomSeconds}s); a long push-in reads as a mistake, kept but shortened by compiler`);
    }
    if (beat.type === 'broll' && length < limits.minBrollSeconds) {
      warnings.push(`broll ${beat.fromChunk}-${beat.toChunk} is only ${length.toFixed(1)}s; compiler will extend to ${limits.minBrollSeconds}s`);
    }
    if (beat.type === 'punch') {
      const chunk = chunkById.get(beat.chunkId);
      if (chunk && !chunk.text.includes(String(beat.text).replace(/\s+/g, ''))) {
        warnings.push(`punch "${beat.text}" is not spoken verbatim in chunk ${beat.chunkId} ("${chunk.text}"); it will appear for the whole chunk`);
      }
    }
    beats.push({ ...beat, _range: range });
  }

  // 4. No overlapping B-roll / zoom / effect of the same kind.
  for (const type of ['broll', 'zoom', 'effect']) {
    const seen = [];
    beats = beats.filter(beat => {
      if (beat.type !== type) return true;
      if (seen.some(other => overlaps(other._range, beat._range))) {
        warnings.push(`${type} ${beat.fromChunk}-${beat.toChunk} overlaps an earlier ${type}, dropped`);
        return false;
      }
      seen.push(beat);
      return true;
    });
  }

  // 5. Density caps keep the video from feeling like a slot machine.
  beats = capDensity(beats, 'punch', limits.punchPerMinute, totalDuration, warnings);
  beats = capDensity(beats, 'broll', limits.brollPerMinute, totalDuration, warnings);
  beats = capDensity(beats, 'effect', limits.effectPerMinute, totalDuration, warnings);

  // 6. A punch and a fullscreen B-roll at the same time: lift the punch to the top.
  const fullscreen = beats.filter(beat => beat.type === 'broll' && beat.layout === 'fullscreen');
  for (const beat of beats) {
    if (beat.type !== 'punch') continue;
    if (fullscreen.some(other => overlaps(other._range, beat._range)) && beat.position !== 'top') {
      warnings.push(`punch "${beat.text}" coincides with fullscreen B-roll; moved to top`);
      beat.position = 'top';
    }
  }

  beats.sort((left, right) => left._range.start - right._range.start);
  result.beats = beats.map(({ _range, ...beat }) => beat);
  return { plan: result, warnings };
}
