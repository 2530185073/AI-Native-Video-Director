import { chunkRange, phraseTiming } from '../timeline/chunker.js';
import { DEFAULT_LIMITS } from '../director/lint.js';
import { AUDIO_LIBRARY, DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME, linearToDb } from '../director/audio.js';

export const TRACKS = {
  video: 'video_main',
  narration: 'audio_narration',
  bgm: 'audio_bgm',
  sfx: ['audio_sfx_1', 'audio_sfx_2'],
  subtitle: 'subtitle',
  punch: 'punch_text',
  broll: 'broll',
  pip: 'pip_face',
  effect: 'effect_01'
};

// Layer bands (see VectCut 轨道层级说明): text base is 15000, images 0.
export const LAYERS = {
  video: 0,
  broll: 100,
  brollFullscreen: 200,
  pip: 300,
  subtitle: 0,
  punch: 20
};

/**
 * Reading is faster than listening: a line that appears ~100 ms before the first word
 * feels synchronised, one that appears after it feels late (OpusClip's timing study).
 */
export const SUBTITLE_LEAD = 0.12;

const round2 = value => Math.round(value * 100) / 100;

function highlightStyles(text, highlights, style) {
  const styles = [];
  const chars = Array.from(text);
  for (const word of highlights || []) {
    const target = Array.from(String(word));
    if (!target.length) continue;
    for (let index = 0; index <= chars.length - target.length; index += 1) {
      if (target.every((char, offset) => chars[index + offset] === char)) {
        styles.push({
          start: index,
          end: index + target.length,
          style: {
            size: Math.round(style.fontSize * style.highlightScale),
            bold: true,
            italic: false,
            underline: false,
            color: style.highlightColor
          },
          border: { alpha: 1, color: style.strokeColor, width: style.strokeWidth }
        });
        break;
      }
    }
  }
  return styles.sort((left, right) => left.start - right.start);
}

function subtitleBaseParams(style, layout, canvas) {
  const placement = layout.subtitle(style.position);
  const params = {
    font: style.font,
    font_color: style.color,
    font_size: style.fontSize,
    bold: style.bold !== false,
    italic: false,
    underline: false,
    align: 1,
    track_name: TRACKS.subtitle,
    relative_index: LAYERS.subtitle,
    transform_x_px: placement.transform_x_px,
    transform_y_px: placement.transform_y_px,
    fixed_width: placement.fixed_width,
    border_alpha: 1,
    border_color: style.strokeColor,
    border_width: style.strokeWidth,
    shadow_enabled: true,
    shadow_alpha: 0.6,
    shadow_distance: 4,
    shadow_smoothing: 0.3,
    width: canvas.width,
    height: canvas.height
  };
  if (style.intro) {
    params.intro_animation = style.intro;
    params.intro_duration = 0.2;
  }
  if (style.background?.enabled) {
    params.background_color = style.background.color || '#000000';
    params.background_alpha = style.background.alpha ?? 0.6;
    params.background_style = 0;
    params.background_round_radius = 0.2;
    params.background_height = 0.16;
    params.background_width = 0.16;
  }
  return params;
}

function compileSubtitles({ plan, chunks, layout, canvas }) {
  const style = plan.subtitleStyle;
  const decisions = new Map(plan.chunks.map(entry => [entry.id, entry]));
  const base = subtitleBaseParams(style, layout, canvas);
  const items = [];
  for (const chunk of chunks) {
    const decision = decisions.get(chunk.id);
    if (decision?.hide) continue;
    items.push({
      text: chunk.text,
      start: chunk.start,
      end: chunk.end,
      text_styles: highlightStyles(chunk.text, decision?.highlights, style)
    });
  }
  if (!items.length) return [];
  // Every line change happens SUBTITLE_LEAD before the next line's first word: the outgoing
  // line lets go a little early (hearing lags reading) and the incoming one is already there.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const previous = items[index - 1];
    const lead = Math.min(SUBTITLE_LEAD, previous ? Math.max(0, item.start - previous.start - 0.5) : item.start);
    if (lead <= 0) continue;
    const boundary = round2(item.start - lead);
    if (previous && previous.end > boundary - 0.02) previous.end = round2(Math.max(previous.start + 0.3, boundary - 0.02));
    item.start = boundary;
  }

  const batch = {
    ...base,
    texts: items.map(item => item.text),
    starts: items.map(item => item.start),
    ends: items.map(item => item.end),
    text_styles_list: items.map(item => item.text_styles)
  };
  const fallback = items.map(item => ({ op: 'add_text', params: { ...base, ...item } }));
  return [{ op: 'add_batch_text', params: batch, fallback, note: `${items.length} subtitle lines` }];
}

/** A hook title must be on screen before the thumb reaches the scroll button. */
export const HOOK_PUNCH_LATEST = 1.0;

/**
 * The moment a beat becomes visible; punches snap to the spoken word, ranges to their
 * first chunk. A punch on the opening line behaves like a title card: it appears with
 * the first frame instead of waiting for the word, so the hook reads at scroll speed.
 */
function beatStart(beat, chunks) {
  if (beat.type === 'punch') {
    const chunk = chunks.find(entry => entry.id === beat.chunkId);
    if (!chunk) return null;
    const timing = phraseTiming(chunk, beat.text);
    const spoken = timing.exact ? timing.start : chunk.start;
    if (chunk === chunks[0]) return Math.max(0, Math.min(spoken, chunk.start, HOOK_PUNCH_LATEST));
    return spoken;
  }
  const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
  return range ? range.start : null;
}

export const PUNCH_MIN_HOLD = 1.4;
export const PUNCH_FLOOR_HOLD = 0.8;
export const ZOOM_RAMP_IN = 0.25;
export const ZOOM_RAMP_OUT = 0.6;

function compilePunch(beat, { chunks, layout, canvas, plan, nextPunchStart = Infinity, videoEnd = Infinity }) {
  const chunk = chunks.find(entry => entry.id === beat.chunkId);
  if (!chunk) return null;
  // Appear when the word is spoken; stay until the line ends but never less than PUNCH_MIN_HOLD
  // (a sentence-final keyword would otherwise flash for a few hundred ms). Yield to the next punch.
  const start = beatStart(beat, chunks);
  let end = Math.max(chunk.end, start + PUNCH_MIN_HOLD);
  end = Math.min(end, nextPunchStart - 0.1, videoEnd);
  end = Math.max(end, Math.min(start + PUNCH_FLOOR_HOLD, videoEnd));
  const placement = layout.punch(beat.position || 'above_head');
  const params = {
    text: beat.text,
    start: round2(start),
    end: round2(end),
    track_name: TRACKS.punch,
    relative_index: LAYERS.punch,
    font_size: beat.fontSize || 18,
    bold: true,
    align: 1,
    transform_x_px: placement.transform_x_px,
    transform_y_px: placement.transform_y_px,
    fixed_width: placement.fixed_width,
    intro_animation: beat.intro || '弹入',
    intro_duration: 0.25,
    width: canvas.width,
    height: canvas.height
  };
  if (beat.flowerId) {
    params.effect_effect_id = beat.flowerId;
  } else {
    params.font = plan.subtitleStyle.font;
    params.font_color = beat.color || plan.subtitleStyle.highlightColor;
    params.border_alpha = 1;
    params.border_color = plan.subtitleStyle.strokeColor;
    params.border_width = Math.max(plan.subtitleStyle.strokeWidth, 20);
    params.shadow_enabled = true;
  }
  if (beat.loop) {
    params.loop_animation = beat.loop;
    params.loop_duration = 0.6;
  }
  if (beat.outro) {
    params.outro_animation = beat.outro;
    params.outro_duration = 0.2;
  }
  return { op: 'add_text', params, note: `punch "${beat.text}" (${beat.reason})` };
}

function compileZooms(beats, { chunks, layout, limits }) {
  const zooms = beats.filter(beat => beat.type === 'zoom');
  if (!zooms.length) return [];
  const propertyTypes = [];
  const times = [];
  const values = [];
  const push = (type, time, value) => { propertyTypes.push(type); times.push(round2(time)); values.push(String(value)); };
  // Push in quickly so it lands on the word like a beat; drift back slowly so the release is invisible.
  const rampIn = ZOOM_RAMP_IN;
  const rampOut = ZOOM_RAMP_OUT;

  let cursor = -1;
  for (const beat of zooms) {
    const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
    if (!range) continue;
    const start = Math.max(range.start, cursor + 0.05);
    const end = Math.min(range.end, start + limits.maxZoomSeconds);
    if (end - start < rampIn + rampOut + 0.2) continue;
    const scale = beat.scale;
    const anchor = layout.zoomAnchor(scale);
    push('uniform_scale', start, '1.0');
    push('uniform_scale', start + rampIn, scale.toFixed(3));
    push('uniform_scale', end - rampOut, scale.toFixed(3));
    push('uniform_scale', end, '1.0');
    for (const axis of ['position_x_px', 'position_y_px']) {
      push(axis, start, '0');
      push(axis, start + rampIn, anchor[axis]);
      push(axis, end - rampOut, anchor[axis]);
      push(axis, end, '0');
    }
    cursor = end;
  }
  if (!times.length) return [];
  return [{
    op: 'add_video_keyframe',
    params: { track_name: TRACKS.video, property_types: propertyTypes, times, values },
    note: `${zooms.length} zoom beat(s)`
  }];
}

/** Composition hint appended to the image prompt when the speaker window covers the top-left corner. */
const PIP_FACE_PROMPT_HINT = '构图：主体放在画面中部偏下，左上角约三分之一区域留作干净的留白或背景，不要把重要内容放在左上角。';

function compileBroll(beat, { chunks, layout, canvas, limits, style, inputs = {} }) {
  const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
  if (!range) return null;
  const placement = layout.broll(beat.layout || 'card_top');
  const covers = Boolean(placement.coversPerson);
  const pipFace = placement.layout === 'pip_face';
  const minSeconds = covers ? Math.max(limits.minBrollSeconds, limits.minFullscreenSeconds || 0) : limits.minBrollSeconds;
  let start = range.start;
  let end = Math.max(range.end, start + minSeconds);
  if (end - start > limits.maxBrollSeconds) end = start + limits.maxBrollSeconds;
  if (inputs.duration) end = Math.min(end, inputs.duration);
  const image = {
    op: 'broll_image',
    prompt: pipFace ? `${beat.prompt}\n${PIP_FACE_PROMPT_HINT}` : beat.prompt,
    aspect: placement.aspect,
    stylePrompt: style,
    target: { widthPx: placement.widthPx, heightPx: placement.heightPx, fit: covers ? 'cover' : 'contain' },
    params: {
      start: round2(start),
      end: round2(end),
      track_name: TRACKS.broll,
      relative_index: covers ? LAYERS.brollFullscreen : LAYERS.broll,
      transform_x_px: placement.transform_x_px,
      transform_y_px: placement.transform_y_px,
      intro_animation: beat.imageIntro || (covers ? '渐显' : '放大'),
      intro_animation_duration: 0.3,
      outro_animation: beat.outro || '缩小',
      outro_animation_duration: 0.25,
      width: canvas.width,
      height: canvas.height,
      ...(covers ? {} : { mask_type: '矩形', mask_round_corner: 12 })
    },
    note: `broll ${placement.layout} (${beat.reason})`
  };
  if (!pipFace) return image;

  // The speaker stays on screen: a muted second copy of the clip, circle-masked around the
  // face and parked in the corner above the picture. Optional — if the PiP fails the
  // picture still plays full-frame.
  const pip = placement.pip;
  const window = {
    op: 'add_video',
    params: {
      video_url: inputs.videoUrl,
      start: round2(start),
      end: round2(end),
      target_start: round2(start),
      ...(inputs.duration ? { duration: inputs.duration } : {}),
      track_name: TRACKS.pip,
      relative_index: LAYERS.pip,
      volume: -100,
      scale_x: pip.scale,
      scale_y: pip.scale,
      transform_x_px: pip.transform_x_px,
      transform_y_px: pip.transform_y_px,
      mask_type: pip.mask_type,
      mask_center_x: pip.mask_center_x,
      mask_center_y: pip.mask_center_y,
      mask_size: pip.mask_size,
      mask_feather: 0,
      intro_animation: '渐显',
      intro_animation_duration: 0.25,
      outro_animation: '缩小',
      outro_animation_duration: 0.25,
      width: canvas.width,
      height: canvas.height
    },
    optional: true,
    note: `speaker window for pip_face broll (${beat.reason})`
  };
  return [image, window];
}

function compileEffect(beat, { chunks, canvas, limits }) {
  const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
  if (!range) return null;
  const glitch = beat.name === '色差故障';
  const start = range.start;
  const end = Math.min(range.end, start + (glitch ? 0.5 : limits.maxEffectSeconds));
  return {
    op: 'add_effect',
    params: {
      effect_type: beat.name,
      effect_category: 'scene',
      start: round2(start),
      end: round2(Math.max(end, start + 0.3)),
      track_name: TRACKS.effect,
      width: canvas.width,
      height: canvas.height
    },
    optional: true,
    note: `effect ${beat.name} (${beat.reason})`
  };
}

/**
 * Lay a music track end-to-end under the video. VectCut has no loop flag, so a track
 * shorter than the video is repeated back-to-back; the first copy fades in and the
 * last one is trimmed to the video end and fades out.
 */
export function bgmOps({ url, trackDuration, videoDuration, volumeDb, trackName = TRACKS.bgm, fadeIn = 0.8, fadeOut = 1.2 }) {
  if (!url || !videoDuration) return [];
  const ops = [];
  const total = Math.max(0.5, videoDuration);
  const pieceLength = trackDuration && trackDuration > 1 ? trackDuration : total;
  let cursor = 0;
  let index = 0;
  while (cursor < total - 0.05) {
    const length = Math.min(pieceLength, total - cursor);
    const last = cursor + length >= total - 0.05;
    const params = {
      audio_url: url,
      start: 0,
      end: round2(length),
      target_start: round2(cursor),
      track_name: trackName,
      volume: volumeDb
    };
    if (trackDuration) params.duration = trackDuration;
    if (index === 0) params.fade_in_duration = fadeIn;
    if (last) params.fade_out_duratioin = Math.min(fadeOut, length / 2);
    ops.push({ op: 'add_audio', params, optional: true, note: index === 0 ? 'background music' : `background music loop ${index + 1}` });
    cursor += length;
    index += 1;
    if (index > 60) break;
  }
  return ops;
}

function compileBgm({ plan, inputs, duration, library }) {
  if (inputs.disableBgm) return [];
  const volumeDb = linearToDb(inputs.bgmVolume ?? DEFAULT_BGM_VOLUME);
  if (inputs.bgmUrl) {
    const known = library.bgm.find(item => item.url === inputs.bgmUrl);
    const trackDuration = inputs.bgmDuration || known?.duration;
    if (!trackDuration) {
      return [{ op: 'bgm_fill', params: { audio_url: inputs.bgmUrl, volume: volumeDb, track_name: TRACKS.bgm }, videoDuration: duration, optional: true, note: 'background music (custom url, duration resolved at run time)' }];
    }
    return bgmOps({ url: inputs.bgmUrl, trackDuration, videoDuration: duration, volumeDb });
  }
  const track = plan.bgm?.track;
  if (!track || track === 'none') return [];
  const item = library.findBgm(track);
  if (!item) return [];
  const ops = bgmOps({ url: item.url, trackDuration: item.duration, videoDuration: duration, volumeDb });
  if (ops[0]) ops[0].note = `background music ${track} (${plan.bgm.reason})`;
  return ops;
}

/**
 * One short `add_audio` per beat that asked for a sound effect. Effects are trimmed
 * to their punchy part and spread over two tracks so that near-simultaneous hits
 * never collide on the same track.
 */
function compileSfx({ plan, chunks, inputs, library }) {
  const master = inputs.sfxVolume ?? DEFAULT_SFX_VOLUME;
  const hits = [];
  for (const beat of plan.beats) {
    if (!beat.sfx) continue;
    const item = library.findSfx(beat.sfx);
    const start = beatStart(beat, chunks);
    if (!item || start == null) continue;
    hits.push({ beat, item, start: Math.max(0, start - (beat.type === 'broll' ? 0.08 : 0)) });
  }
  hits.sort((left, right) => left.start - right.start);

  const trackEnds = TRACKS.sfx.map(() => -Infinity);
  const ops = [];
  for (const { beat, item, start } of hits) {
    const length = Math.min(item.trim || item.duration, item.duration);
    let trackIndex = trackEnds.findIndex(end => end <= start);
    if (trackIndex < 0) trackIndex = trackEnds.indexOf(Math.min(...trackEnds));
    trackEnds[trackIndex] = start + length;
    ops.push({
      op: 'add_audio',
      params: {
        audio_url: item.url,
        start: 0,
        end: round2(length),
        duration: item.duration,
        target_start: round2(start),
        track_name: TRACKS.sfx[trackIndex],
        volume: linearToDb(master * (item.gain ?? 1))
      },
      optional: true,
      note: `sfx ${item.id} on ${beat.type}${beat.text ? ` "${beat.text}"` : ''}`
    });
  }
  return ops;
}

/**
 * Compile an approved editing plan into an ordered list of VectCut operations.
 *
 * Pure function: no network, deterministic, easy to snapshot in tests and to show
 * to an operator before anything is spent on API calls or renders.
 */
export function compilePlan({
  plan,
  chunks,
  layout,
  inputs,
  canvas = layout.canvas,
  limits = DEFAULT_LIMITS,
  imageStyle,
  audioLibrary = AUDIO_LIBRARY
}) {
  if (!inputs?.videoUrl) throw new Error('inputs.videoUrl is required');
  const ops = [];
  const duration = inputs.duration || (chunks.length ? chunks[chunks.length - 1].end : undefined);

  ops.push({
    op: 'create_draft',
    params: { width: canvas.width, height: canvas.height, name: inputs.name || `AI二次精剪 ${new Date().toISOString().slice(0, 16)}` }
  });

  const videoParams = {
    video_url: inputs.videoUrl,
    start: 0,
    target_start: 0,
    track_name: TRACKS.video,
    relative_index: LAYERS.video,
    width: canvas.width,
    height: canvas.height
  };
  if (duration) { videoParams.end = round2(duration); videoParams.duration = duration; }
  if (inputs.audioUrl && inputs.replaceAudio) videoParams.volume = -100;
  ops.push({ op: 'add_video', params: videoParams, note: 'main talking-head clip' });

  if (inputs.audioUrl && inputs.replaceAudio) {
    ops.push({
      op: 'add_audio',
      params: { audio_url: inputs.audioUrl, start: 0, target_start: 0, track_name: TRACKS.narration, ...(duration ? { end: round2(duration), duration } : {}) },
      note: 'narration audio replaces the clip audio'
    });
  }
  ops.push(...compileBgm({ plan, inputs, duration, library: audioLibrary }));

  ops.push(...compileZooms(plan.beats, { chunks, layout, limits }));
  ops.push(...compileSubtitles({ plan, chunks, layout, canvas }));

  const imageStylePrompt = imageStyle || `${plan.concept}。整体风格统一，画面中不要出现任何文字、水印、logo。`;
  const punchStarts = plan.beats
    .filter(beat => beat.type === 'punch')
    .map(beat => beatStart(beat, chunks))
    .filter(value => value != null)
    .sort((a, b) => a - b);
  const videoEnd = duration || Infinity;
  for (const beat of plan.beats) {
    let op = null;
    if (beat.type === 'punch') {
      const start = beatStart(beat, chunks);
      const nextPunchStart = punchStarts.find(value => value > start + 0.05) ?? Infinity;
      op = compilePunch(beat, { chunks, layout, canvas, plan, nextPunchStart, videoEnd });
    }
    else if (beat.type === 'broll') op = compileBroll(beat, { chunks, layout, canvas, limits, style: imageStylePrompt, inputs: { videoUrl: inputs.videoUrl, duration } });
    else if (beat.type === 'effect') op = compileEffect(beat, { chunks, canvas, limits });
    if (Array.isArray(op)) ops.push(...op);
    else if (op) ops.push(op);
  }

  ops.push(...compileSfx({ plan, chunks, inputs, library: audioLibrary }));

  ops.push({ op: 'query_script', params: {}, note: 'verify draft before hand-off' });
  return ops;
}

/** Human-readable summary for logs / CLI output. */
export function summarizeOps(ops) {
  const counts = {};
  for (const op of ops) counts[op.op] = (counts[op.op] || 0) + 1;
  return Object.entries(counts).map(([name, count]) => `${name} x${count}`).join(', ');
}
