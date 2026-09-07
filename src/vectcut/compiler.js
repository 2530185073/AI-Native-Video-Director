import { chunkRange, phraseTiming } from '../timeline/chunker.js';
import { DEFAULT_LIMITS } from '../director/lint.js';

export const TRACKS = {
  video: 'video_main',
  narration: 'audio_narration',
  bgm: 'audio_bgm',
  subtitle: 'subtitle',
  punch: 'punch_text',
  broll: 'broll',
  effect: 'effect_01'
};

// Layer bands (see VectCut 轨道层级说明): text base is 15000, images 0.
export const LAYERS = {
  video: 0,
  broll: 100,
  brollFullscreen: 200,
  subtitle: 0,
  punch: 20
};

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

function compilePunch(beat, { chunks, layout, canvas, plan }) {
  const chunk = chunks.find(entry => entry.id === beat.chunkId);
  if (!chunk) return null;
  const timing = phraseTiming(chunk, beat.text);
  // Appear when the word is spoken, stay until the line ends (min 0.8s so the animation can play).
  const start = timing.exact ? timing.start : chunk.start;
  const end = Math.max(chunk.end, start + 0.8);
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
  const ramp = 0.35;

  let cursor = -1;
  for (const beat of zooms) {
    const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
    if (!range) continue;
    const start = Math.max(range.start, cursor + 0.05);
    const end = Math.min(range.end, start + limits.maxZoomSeconds);
    if (end - start < ramp * 2 + 0.2) continue;
    const scale = beat.scale;
    const anchor = layout.zoomAnchor(scale);
    push('uniform_scale', start, '1.0');
    push('uniform_scale', start + ramp, scale.toFixed(3));
    push('uniform_scale', end - ramp, scale.toFixed(3));
    push('uniform_scale', end, '1.0');
    for (const axis of ['position_x_px', 'position_y_px']) {
      push(axis, start, '0');
      push(axis, start + ramp, anchor[axis]);
      push(axis, end - ramp, anchor[axis]);
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

function compileBroll(beat, { chunks, layout, canvas, limits, style }) {
  const range = chunkRange(chunks, beat.fromChunk, beat.toChunk);
  if (!range) return null;
  let start = range.start;
  let end = Math.max(range.end, start + limits.minBrollSeconds);
  if (end - start > limits.maxBrollSeconds) end = start + limits.maxBrollSeconds;
  const placement = layout.broll(beat.layout || 'card_top');
  const fullscreen = placement.layout === 'fullscreen';
  return {
    op: 'broll_image',
    prompt: beat.prompt,
    aspect: placement.aspect,
    stylePrompt: style,
    target: { widthPx: placement.widthPx, heightPx: placement.heightPx, fit: fullscreen ? 'cover' : 'contain' },
    params: {
      start: round2(start),
      end: round2(end),
      track_name: TRACKS.broll,
      relative_index: fullscreen ? LAYERS.brollFullscreen : LAYERS.broll,
      transform_x_px: placement.transform_x_px,
      transform_y_px: placement.transform_y_px,
      intro_animation: beat.imageIntro || (fullscreen ? '渐显' : '放大'),
      intro_animation_duration: 0.3,
      outro_animation: beat.outro || (fullscreen ? '缩小' : '缩小'),
      outro_animation_duration: 0.25,
      width: canvas.width,
      height: canvas.height,
      ...(fullscreen ? {} : { mask_type: '矩形', mask_round_corner: 12 })
    },
    note: `broll ${placement.layout} (${beat.reason})`
  };
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
  imageStyle
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
  if (inputs.bgmUrl) {
    ops.push({
      op: 'add_audio',
      params: {
        audio_url: inputs.bgmUrl,
        start: 0,
        target_start: 0,
        track_name: TRACKS.bgm,
        volume: inputs.bgmVolumeDb ?? -18,
        fade_in_duration: 0.8,
        fade_out_duratioin: 1.2,
        ...(duration ? { end: round2(duration) } : {})
      },
      optional: true,
      note: 'background music'
    });
  }

  ops.push(...compileZooms(plan.beats, { chunks, layout, limits }));
  ops.push(...compileSubtitles({ plan, chunks, layout, canvas }));

  const imageStylePrompt = imageStyle || `${plan.concept}。整体风格统一，画面中不要出现任何文字、水印、logo。`;
  for (const beat of plan.beats) {
    let op = null;
    if (beat.type === 'punch') op = compilePunch(beat, { chunks, layout, canvas, plan });
    else if (beat.type === 'broll') op = compileBroll(beat, { chunks, layout, canvas, limits, style: imageStylePrompt });
    else if (beat.type === 'effect') op = compileEffect(beat, { chunks, canvas, limits });
    if (op) ops.push(op);
  }

  ops.push({ op: 'query_script', params: {}, note: 'verify draft before hand-off' });
  return ops;
}

/** Human-readable summary for logs / CLI output. */
export function summarizeOps(ops) {
  const counts = {};
  for (const op of ops) counts[op.op] = (counts[op.op] || 0) + 1;
  return Object.entries(counts).map(([name, count]) => `${name} x${count}`).join(', ');
}
