import { chunkRange } from '../timeline/chunker.js';
import { FLOWER_TEXT, flowerById } from './catalog.js';

export const DEFAULT_LIMITS = {
  punchPerMinute: 8,
  brollPerMinute: 5.5,
  effectPerMinute: 3,
  maxZoomSeconds: 8,
  // A push-in that pops back out inside two seconds reads as nausea, not emphasis.
  minZoomSeconds: 2,
  // Stillness between pushes is what makes a push register; back-to-back zooms habituate.
  minZoomGapSeconds: 2.5,
  minBrollSeconds: 1.2,
  maxBrollSeconds: 6,
  // Under two seconds a full-frame cutaway reads as a glitch.
  minFullscreenSeconds: 2,
  // Above ~a third of the runtime the clip stops being a talking head and becomes a slideshow.
  maxBrollRatio: 0.42,
  // Viewers decide in the first three seconds; never cut away from the face before they know who is talking.
  hookSeconds: 3,
  maxEffectSeconds: 4,
  sfxPerMinute: 8,
  minSfxGapSeconds: 0.7,
  maxHighlightRatio: 0.6,
  // Distinct punch looks (flower preset or colour) per video; three or more reads as random.
  maxPunchStyles: 2,
  // One "apex" word per video: only a single punch may use the largest font size, the rest sit
  // at least this many points below it. Two equally loud words make neither of them the peak.
  apexPunch: true,
  apexStep: 3,
  // The last line (conclusion / CTA) is spoken to camera: no picture may cover the face there.
  protectClosing: true,
  // Minimum opacity of the subtitle bar when the footage has a busy lower third (printed
  // clothing, patterned wall). Black at 35-60% is the usual range; busy backgrounds need the top of it.
  busyScrimAlpha: 0.6,
  // Plain-colour punch text may only use white or the subtitle highlight colour (one neutral + one accent).
  punchPalette: true,
  // A picture card narrower than this share of the canvas is a thumbnail nobody can read;
  // in tight framing it is promoted to a full-frame picture with the speaker in a window.
  minCardWidth: 0.4,
  // Longest stretch with no visual change before a gentle "keep the frame alive" push is added.
  maxStaticSeconds: 8,
  staticFillScale: 1.08,
  // Sound design is punctuation with a grammar: a whoosh on a word or a ding on a picture sounds wrong.
  sfxByBeatType: {
    punch: { allowed: ['pop', 'ding', 'error', 'success', 'click'], fallback: 'pop' },
    broll: { allowed: ['whoosh', 'whoosh_soft', 'click'], fallback: 'whoosh' },
    effect: { allowed: ['whoosh', 'whoosh_soft', 'click', 'error'], fallback: 'whoosh' },
    zoom: { allowed: ['whoosh_soft'], fallback: null }
  }
};

export const STATIC_FILL_REASON = '系统兜底：连续静止段补一次轻推，保持画面呼吸';

/** Layouts that hide the talking head behind the picture (fully or, for pip_face, all but a window). */
export const COVERING_LAYOUTS = new Set(['fullscreen', 'pip_face']);

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** Near-white: light enough to read as "the neutral colour", with barely any tint. */
export function isNeutralWhite(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  return min >= 225 && max - min <= 30;
}

const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** Coarse colour family of a hex colour, matching the `hue` vocabulary of the flower presets. */
export function colorFamily(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  if (isNeutralWhite(hex)) return 'white';
  const r = rgb.r / 255; const g = rgb.g / 255; const b = rgb.b / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.12) return 'neutral';
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 20 || hue >= 335) return 'red';
  if (hue < 75) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 265) return 'blue';
  return 'purple';
}

const ANY_ACCENT_HUES = new Set(['white', 'neutral', 'multi']);

function beatRange(beat, chunks) {
  if (beat.type === 'punch') return chunkRange(chunks, beat.chunkId, beat.chunkId);
  return chunkRange(chunks, beat.fromChunk, beat.toChunk);
}

function overlaps(a, b) {
  return a && b && a.start < b.end && b.start < a.end;
}

/**
 * Find stretches longer than `maxStaticSeconds` with no visual beat at all and drop a
 * gentle zoom into the middle of each. This is the floor a human editor would apply
 * during QA ("nothing moved for ten seconds"), not a creative decision — so it is
 * deliberately the least intrusive move available and is labelled as such.
 */
function fillStaticStretches(beats, chunks, totalDuration, limits, warnings) {
  if (!limits.maxStaticSeconds || !chunks.length) return beats;
  const result = [...beats];
  for (let pass = 0; pass < 12; pass += 1) {
    const events = result.map(beat => beat._range).sort((a, b) => a.start - b.start);
    let cursor = 0;
    let gap = null;
    for (const range of [...events, { start: totalDuration, end: totalDuration }]) {
      if (range.start - cursor > limits.maxStaticSeconds) { gap = { start: cursor, end: range.start }; break; }
      cursor = Math.max(cursor, range.end);
    }
    if (!gap) return result;

    const middle = (gap.start + gap.end) / 2;
    const inside = chunks.filter(chunk => chunk.start >= gap.start + 0.4 && chunk.end <= gap.end - 0.4);
    if (!inside.length) return result;
    let center = inside.reduce((best, chunk) => (
      Math.abs((chunk.start + chunk.end) / 2 - middle) < Math.abs((best.start + best.end) / 2 - middle) ? chunk : best
    ));
    let from = inside.indexOf(center);
    let to = from;
    const span = () => inside[to].end - inside[from].start;
    while (span() < Math.max(limits.minZoomSeconds, 2.5) && (from > 0 || to < inside.length - 1)) {
      const growRight = to < inside.length - 1 && (from === 0 || (inside[to + 1].end - inside[from].start) <= (inside[to].end - inside[from - 1].start));
      if (growRight) to += 1; else from -= 1;
      if (span() > 4.5) break;
    }
    const range = { start: inside[from].start, end: inside[to].end };
    result.push({
      type: 'zoom',
      fromChunk: inside[from].id,
      toChunk: inside[to].id,
      scale: limits.staticFillScale,
      sfx: null,
      reason: STATIC_FILL_REASON,
      _range: range
    });
    warnings.push(`no visual change for ${(gap.end - gap.start).toFixed(1)}s (${gap.start.toFixed(1)}-${gap.end.toFixed(1)}s); added a ${limits.staticFillScale} zoom on chunks ${inside[from].id}-${inside[to].id}`);
  }
  return result;
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
export function lintPlan(plan, { chunks, layout, duration, source, limits = DEFAULT_LIMITS } = {}) {
  const warnings = [];
  const result = structuredClone(plan);
  const chunkById = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const totalDuration = duration || (chunks.length ? chunks[chunks.length - 1].end : 60);

  // 0. Product lock: talking-head subtitles ship without a black bar. Stroke + shadow carry
  //    readability even on a busy lower third; a scrim fights the clean look the client wants.
  if (result.subtitleStyle?.background?.enabled) {
    warnings.push('subtitle black bar disabled (product lock: stroke-only subtitles)');
  }
  result.subtitleStyle.background = { enabled: false };

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
  const highlighted = result.chunks.filter(entry => entry.highlights.length).length;
  if (result.chunks.length >= 6 && highlighted / result.chunks.length > limits.maxHighlightRatio) {
    warnings.push(`highlights on ${highlighted}/${result.chunks.length} lines (> ${Math.round(limits.maxHighlightRatio * 100)}%); emphasis is diluted, consider a stricter brief`);
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
  const punchedChunks = new Set();
  const chunkIndex = new Map(chunks.map((chunk, index) => [chunk.id, index]));
  for (const original of result.beats) {
    const beat = { ...original };
    let range = beatRange(beat, chunks);
    if (!range) {
      warnings.push(`${beat.type} beat references unknown chunks, dropped`);
      continue;
    }
    let length = range.end - range.start;
    if (beat.type === 'zoom') {
      if (length > limits.maxZoomSeconds) {
        warnings.push(`zoom ${beat.fromChunk}-${beat.toChunk} lasts ${length.toFixed(1)}s (> ${limits.maxZoomSeconds}s); a long push-in reads as a mistake, kept but shortened by compiler`);
      }
      // Too short to register: stretch over the following line(s) instead of dropping the intent.
      let toIndex = chunkIndex.get(beat.toChunk);
      while (length < limits.minZoomSeconds && toIndex != null && toIndex < chunks.length - 1) {
        toIndex += 1;
        const extended = chunkRange(chunks, beat.fromChunk, chunks[toIndex].id);
        if (!extended) break;
        range = extended;
        length = range.end - range.start;
      }
      if (chunks[toIndex]?.id !== beat.toChunk) {
        warnings.push(`zoom ${beat.fromChunk}-${beat.toChunk} was under ${limits.minZoomSeconds}s; extended to chunk ${chunks[toIndex].id}`);
        beat.toChunk = chunks[toIndex].id;
      }
    }
    if (beat.type === 'broll') {
      if (length < limits.minBrollSeconds) {
        warnings.push(`broll ${beat.fromChunk}-${beat.toChunk} is only ${length.toFixed(1)}s; compiler will extend to ${limits.minBrollSeconds}s`);
      }
      // A card that the layout engine can only fit as a thumbnail is worse than no card. When the
      // face fills the frame, show the object full-frame and keep the speaker in a window instead.
      if (layout && !COVERING_LAYOUTS.has(beat.layout) && range.start >= limits.hookSeconds && length >= limits.minFullscreenSeconds) {
        const resolved = layout.broll(beat.layout || 'card_top');
        if (!COVERING_LAYOUTS.has(resolved.layout) && resolved.width < limits.minCardWidth) {
          warnings.push(`broll ${beat.fromChunk}-${beat.toChunk} as ${beat.layout} would only be ${Math.round(resolved.width * 100)}% of the canvas wide in this framing; promoted to pip_face`);
          beat.layout = 'pip_face';
        }
      }
      if (COVERING_LAYOUTS.has(beat.layout) && range.start < limits.hookSeconds) {
        warnings.push(`${beat.layout} broll at ${range.start.toFixed(1)}s cuts away from the face inside the ${limits.hookSeconds}s hook; downgraded to card_top`);
        beat.layout = 'card_top';
      }
      // The face carries the hook *and* the conclusion: the closing line is where the speaker
      // looks at the viewer and asks for something, so no picture may cover it.
      const closingId = chunks[chunks.length - 1]?.id;
      const protectClosing = limits.protectClosing && chunks.length >= 4 && totalDuration >= 12;
      if (protectClosing && COVERING_LAYOUTS.has(beat.layout) && chunkIndex.get(beat.toChunk) === chunks.length - 1) {
        if (beat.fromChunk === closingId) {
          warnings.push(`${beat.layout} broll on the closing line (chunk ${closingId}) would hide the face during the conclusion; downgraded to lower_card`);
          beat.layout = 'lower_card';
        } else {
          const trimmedTo = chunks[chunks.length - 2].id;
          const trimmed = chunkRange(chunks, beat.fromChunk, trimmedTo);
          if (trimmed && trimmed.end - trimmed.start >= limits.minFullscreenSeconds) {
            warnings.push(`${beat.layout} broll ${beat.fromChunk}-${beat.toChunk} ran into the closing line; ends at chunk ${trimmedTo} so the face is back for the conclusion`);
            beat.toChunk = trimmedTo;
            range = trimmed;
            length = range.end - range.start;
          } else {
            warnings.push(`${beat.layout} broll ${beat.fromChunk}-${beat.toChunk} would cover the face through the conclusion and is too short to end earlier; downgraded to lower_card`);
            beat.layout = 'lower_card';
          }
        }
      }
      if (COVERING_LAYOUTS.has(beat.layout) && range.start >= limits.hookSeconds && length < limits.minFullscreenSeconds) {
        // Hold the picture over the next line(s) so it lasts long enough to read; only if that is
        // impossible does it shrink to a card.
        const lastHoldIndex = protectClosing ? chunks.length - 2 : chunks.length - 1;
        let toIndex = chunkIndex.get(beat.toChunk);
        let extended = range;
        while (extended.end - extended.start < limits.minFullscreenSeconds && toIndex != null && toIndex < lastHoldIndex && toIndex - chunkIndex.get(beat.toChunk) < 2) {
          toIndex += 1;
          const candidate = chunkRange(chunks, beat.fromChunk, chunks[toIndex].id);
          if (!candidate || candidate.end - candidate.start > limits.maxBrollSeconds) break;
          extended = candidate;
        }
        if (extended.end - extended.start >= limits.minFullscreenSeconds) {
          warnings.push(`${beat.layout} broll ${beat.fromChunk}-${beat.toChunk} was only ${length.toFixed(1)}s; held until chunk ${chunks[toIndex].id} so it reads as a cutaway, not a glitch`);
          beat.toChunk = chunks[toIndex].id;
          range = extended;
          length = range.end - range.start;
        } else {
          warnings.push(`${beat.layout} broll ${beat.fromChunk}-${beat.toChunk} is only ${length.toFixed(1)}s (< ${limits.minFullscreenSeconds}s) and would read as a glitch; downgraded to lower_card`);
          beat.layout = 'lower_card';
        }
      }
    }
    if (beat.type === 'punch') {
      if (punchedChunks.has(beat.chunkId)) {
        warnings.push(`second punch "${beat.text}" on chunk ${beat.chunkId} dropped; one big word per line`);
        continue;
      }
      punchedChunks.add(beat.chunkId);
      const chunk = chunkById.get(beat.chunkId);
      if (chunk && !chunk.text.includes(String(beat.text).replace(/\s+/g, ''))) {
        warnings.push(`punch "${beat.text}" is not spoken verbatim in chunk ${beat.chunkId} ("${chunk.text}"); it will appear for the whole chunk`);
      }
    }
    beats.push({ ...beat, _range: range });
  }

  // 4. No overlapping B-roll / zoom / effect of the same kind; zooms also need stillness between them.
  for (const type of ['broll', 'zoom', 'effect']) {
    const seen = [];
    beats = beats.filter(beat => {
      if (beat.type !== type) return true;
      if (seen.some(other => overlaps(other._range, beat._range))) {
        warnings.push(`${type} ${beat.fromChunk}-${beat.toChunk} overlaps an earlier ${type}, dropped`);
        return false;
      }
      if (type === 'zoom') {
        const previous = seen.find(other => other._range.end <= beat._range.start && beat._range.start - other._range.end < limits.minZoomGapSeconds);
        if (previous) {
          warnings.push(`zoom ${beat.fromChunk}-${beat.toChunk} starts ${(beat._range.start - previous._range.end).toFixed(1)}s after the previous zoom ended (< ${limits.minZoomGapSeconds}s); back-to-back pushes habituate, dropped`);
          return false;
        }
      }
      seen.push(beat);
      return true;
    });
  }

  // 5. Density caps keep the video from feeling like a slot machine.
  beats = capDensity(beats, 'punch', limits.punchPerMinute, totalDuration, warnings);
  beats = capDensity(beats, 'broll', limits.brollPerMinute, totalDuration, warnings);
  beats = capDensity(beats, 'effect', limits.effectPerMinute, totalDuration, warnings);

  // 5b. B-roll share of the runtime: past a third the talking head disappears behind pictures.
  const brollSeconds = list => list.filter(beat => beat.type === 'broll')
    .reduce((sum, beat) => sum + Math.min(limits.maxBrollSeconds, Math.max(limits.minBrollSeconds, beat._range.end - beat._range.start)), 0);
  if (brollSeconds(beats) / totalDuration > limits.maxBrollRatio) {
    const before = brollSeconds(beats);
    // Drop every other cutaway (keeping the first) until the share is back under the cap.
    let parity = 1;
    while (brollSeconds(beats) / totalDuration > limits.maxBrollRatio) {
      const brolls = beats.filter(beat => beat.type === 'broll');
      if (brolls.length <= 1) break;
      const victim = brolls[Math.min(parity, brolls.length - 1)];
      beats = beats.filter(beat => beat !== victim);
      parity = parity + 1 >= brolls.length - 1 ? 1 : parity + 1;
    }
    warnings.push(`broll covered ${before.toFixed(1)}s of ${totalDuration.toFixed(1)}s (> ${Math.round(limits.maxBrollRatio * 100)}%); thinned to ${brollSeconds(beats).toFixed(1)}s so the speaker stays on screen`);
  }

  // 5b2. One neutral + one accent: plain-colour punch text is white or the subtitle highlight
  //      colour, nothing else. A third colour is what makes a video read as "配色杂乱".
  if (limits.punchPalette) {
    const accent = result.subtitleStyle?.highlightColor;
    const accentFamily = colorFamily(accent);
    for (const beat of beats) {
      if (beat.type !== 'punch') continue;
      if (beat.flowerId) {
        // Presets carry their own colour: a blue "knowledge" preset under a yellow highlight is
        // the third colour the reviewer keeps flagging. Swap to a preset in the accent's family,
        // or fall back to plain text in the accent colour.
        const preset = flowerById(beat.flowerId);
        if (!preset || !preset.hue || ANY_ACCENT_HUES.has(preset.hue) || !accentFamily || preset.hue === accentFamily) continue;
        const replacement = FLOWER_TEXT.find(item => item.hue === accentFamily);
        if (replacement) {
          warnings.push(`punch "${beat.text}" uses the ${preset.hue} preset ${preset.name} under a ${accentFamily} highlight (${accent}); swapped to ${replacement.name} so the video keeps one accent`);
          beat.flowerId = replacement.id;
        } else {
          warnings.push(`punch "${beat.text}" uses the ${preset.hue} preset ${preset.name} under a ${accentFamily} highlight (${accent}); no preset in that family, so it becomes plain text in the highlight colour`);
          beat.flowerId = null;
          beat.color = accent;
        }
        continue;
      }
      if (!beat.color || isNeutralWhite(beat.color) || sameColor(beat.color, accent)) continue;
      warnings.push(`punch "${beat.text}" colour ${beat.color} is off-palette (white or highlight ${accent} only); recoloured to the highlight colour`);
      beat.color = accent;
    }
  }

  // 5c. One or two punch looks per video. Keep the most used ones, restyle the strays.
  const punchStyleKey = beat => (beat.flowerId ? `flower:${beat.flowerId}` : `color:${String(beat.color || '').toLowerCase()}`);
  const styleCounts = new Map();
  for (const beat of beats) {
    if (beat.type !== 'punch') continue;
    styleCounts.set(punchStyleKey(beat), (styleCounts.get(punchStyleKey(beat)) || 0) + 1);
  }
  if (limits.maxPunchStyles && styleCounts.size > limits.maxPunchStyles) {
    const ranked = [...styleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const keep = new Set(ranked.slice(0, limits.maxPunchStyles));
    const primary = beats.find(beat => beat.type === 'punch' && punchStyleKey(beat) === ranked[0]);
    let restyled = 0;
    for (const beat of beats) {
      if (beat.type !== 'punch' || keep.has(punchStyleKey(beat))) continue;
      beat.flowerId = primary.flowerId ?? null;
      beat.color = primary.color ?? null;
      restyled += 1;
    }
    warnings.push(`punch text used ${styleCounts.size} different looks (> ${limits.maxPunchStyles}); ${restyled} restyled to match the dominant one so the video reads as one design`);
  }

  // 5d. One apex. The loudest word in the video is an event only if nothing else is as loud:
  //     when several punches share the top size, the one carrying the payoff (a ding/success
  //     beat, then a number, then the earliest) keeps it and the rest step down.
  if (limits.apexPunch) {
    const punches = beats.filter(beat => beat.type === 'punch' && Number.isFinite(beat.fontSize));
    const top = Math.max(...punches.map(beat => beat.fontSize), 0);
    const loudest = punches.filter(beat => beat.fontSize === top);
    if (loudest.length > 1 && top >= 18) {
      const score = beat => (['ding', 'success'].includes(beat.sfx) ? 2 : 0) + (/\d/.test(beat.text) ? 1 : 0);
      const apex = loudest.reduce((best, beat) => (score(beat) > score(best) ? beat : best));
      const stepped = Math.max(14, top - (limits.apexStep || 3));
      for (const beat of loudest) if (beat !== apex) beat.fontSize = stepped;
      warnings.push(`${loudest.length} punches shared the largest size ${top}; "${apex.text}" stays the apex, the other ${loudest.length - 1} stepped down to ${stepped} so the peak reads as a peak`);
    }
  }

  // 6. Punch text and B-roll fighting for the same patch of screen: move the word, keep the picture.
  const brolls = beats.filter(beat => beat.type === 'broll');
  const resolvedBroll = name => (layout ? layout.broll(name).layout : name);
  for (const beat of beats) {
    if (beat.type !== 'punch') continue;
    const clashing = brolls.filter(other => overlaps(other._range, beat._range));
    if (!clashing.length) continue;
    const resolvedPunch = layout ? layout.punch(beat.position || 'above_head').resolved : (beat.position || 'above_head');
    const zones = new Set(clashing.map(other => resolvedBroll(other.layout)));
    if (zones.has('fullscreen') && beat.position !== 'top') {
      warnings.push(`punch "${beat.text}" coincides with fullscreen B-roll; moved to top`);
      beat.position = 'top';
    } else if (zones.has('pip_face') && resolvedPunch === 'above_head') {
      // Speaker window owns the top-left; keep the word at centre-top so it never sits on the subtitle line.
      warnings.push(`punch "${beat.text}" coincides with a pip_face picture; moved to top, clear of the speaker window and subtitles`);
      beat.position = 'top';
    } else if (zones.has('lower_card') && resolvedPunch === 'chest') {
      warnings.push(`punch "${beat.text}" would sit on a lower_card picture; moved to top`);
      beat.position = 'top';
    } else if (zones.has('card_top') && (resolvedPunch === 'above_head' || resolvedPunch === 'top')) {
      warnings.push(`punch "${beat.text}" would sit on a card_top picture; moved to beside_face`);
      beat.position = 'beside_face';
    }
  }

  // 6c. Chest punches sit on the subtitle band in tight talking-head framing — lift them to top.
  for (const beat of beats) {
    if (beat.type !== 'punch') continue;
    if (beat.position === 'chest') {
      warnings.push(`punch "${beat.text}" moved from chest to top so it does not stack on the subtitles`);
      beat.position = 'top';
    }
  }

  // 6b. A stretch with nothing moving for too long gets the gentlest possible push.
  beats = fillStaticStretches(beats, chunks, totalDuration, limits, warnings);

  beats.sort((left, right) => left._range.start - right._range.start);

  // 7. Sound effects are punctuation: the right kind for the beat, never two within the
  //    same breath, never a wall of them.
  const grammar = limits.sfxByBeatType || {};
  for (const beat of beats) {
    if (!beat.sfx) continue;
    const rule = grammar[beat.type];
    if (rule && !rule.allowed.includes(beat.sfx)) {
      warnings.push(`sfx "${beat.sfx}" does not fit a ${beat.type} beat; ${rule.fallback ? `replaced with "${rule.fallback}"` : 'dropped'}`);
      beat.sfx = rule.fallback ?? null;
    }
  }
  let lastSfxAt = -Infinity;
  for (const beat of beats) {
    if (!beat.sfx) continue;
    if (beat._range.start - lastSfxAt < limits.minSfxGapSeconds) {
      warnings.push(`sfx "${beat.sfx}" on ${beat.type} at ${beat._range.start.toFixed(2)}s is within ${limits.minSfxGapSeconds}s of the previous one, dropped`);
      beat.sfx = null;
      continue;
    }
    lastSfxAt = beat._range.start;
  }
  const withSfx = beats.filter(beat => beat.sfx);
  const allowedSfx = Math.max(1, Math.round((limits.sfxPerMinute * Math.max(totalDuration, 15)) / 60));
  if (withSfx.length > allowedSfx) {
    const step = withSfx.length / allowedSfx;
    const keep = new Set();
    for (let index = 0; index < allowedSfx; index += 1) keep.add(withSfx[Math.floor(index * step)]);
    for (const beat of withSfx) if (!keep.has(beat)) beat.sfx = null;
    warnings.push(`sfx: ${withSfx.length} exceed the ${allowedSfx} allowed for a ${Math.round(totalDuration)}s video; thinned`);
  }

  result.beats = beats.map(({ _range, ...beat }) => beat);
  return { plan: result, warnings };
}
