/**
 * Sound design vocabulary for the AI Director: short UI-style sound effects that
 * punctuate visual beats, and a small set of background-music tracks.
 *
 * All URLs are public direct links verified against VectCut `get_duration`; the
 * durations below come from that call, so the compiler can trim SFX and loop BGM
 * without another network round-trip. Replace or extend the lists through
 * `inputs.audioLibrary` / `.env` when you have your own licensed assets.
 */

export const SFX = [
  { id: 'whoosh', url: 'https://tryelements.dev/sfx/whoosh.mp3', duration: 0.57, trim: 0.57, gain: 0.7, hint: '切卡、全屏图进入、镜头推进的起手' },
  { id: 'whoosh_soft', url: 'https://tryelements.dev/sfx/whoosh-alt1.mp3', duration: 1.1, trim: 0.8, gain: 0.6, hint: '更柔的切换，适合故事/情感内容' },
  { id: 'pop', url: 'https://tryelements.dev/sfx/pop.mp3', duration: 1.02, trim: 0.5, gain: 0.7, hint: '花字/贴纸弹出，最百搭' },
  { id: 'click', url: 'https://tryelements.dev/sfx/click.mp3', duration: 1.03, trim: 0.4, gain: 0.6, hint: '列表、卡片逐条出现' },
  { id: 'ding', url: 'https://tryelements.dev/sfx/notification.mp3', duration: 2.12, trim: 0.9, gain: 0.7, hint: '价格、数字、金句、“记住这个”' },
  { id: 'error', url: 'https://tryelements.dev/sfx/error.mp3', duration: 0.53, trim: 0.53, gain: 0.7, hint: '警告、避坑、“千万不要”' },
  { id: 'success', url: 'https://tryelements.dev/sfx/success.mp3', duration: 2.54, trim: 0.6, gain: 0.7, hint: '结论、答对、正确做法' }
];

export const DEFAULT_BGM_TRACK = 'talk_default';

export const BGM = [
  { id: 'talk_default', url: 'https://lf3-lv-music-tos.faceu.com/obj/tos-cn-ve-2774/oYACBQRCMlWBIrZipvQZhI5LAlUFYii0RwEPh', duration: 82.86, hint: '默认通用口播垫乐（知识/干货/带货/生活都可用）' },
  { id: 'lofi_clean', url: 'https://assets.mixkit.co/music/764/764.mp3', duration: 98.17, hint: '更干净的 Lo-Fi，偏理性干货时可选' },
  { id: 'soft_pad', url: 'https://assets.mixkit.co/music/135/135.mp3', duration: 119.16, hint: '更软的垫乐，情感/故事/慢节奏' }
];

/** Linear gain (1 = unchanged, 0.12 = 12%) → the dB value VectCut's `volume` expects. */
export function linearToDb(linear) {
  const value = Number(linear);
  if (!Number.isFinite(value) || value <= 0) return -100;
  if (value === 1) return 0;
  return Math.round(20 * Math.log10(value) * 100) / 100;
}

export const DEFAULT_BGM_VOLUME = 0.12;
export const DEFAULT_SFX_VOLUME = 0.55;

export function createAudioLibrary({ sfx = SFX, bgm = BGM } = {}) {
  return {
    sfx: sfx.map(item => ({ ...item })),
    bgm: bgm.map(item => ({ ...item })),
    findSfx(id) { return this.sfx.find(item => item.id === id) || null; },
    findBgm(id) { return this.bgm.find(item => item.id === id) || null; }
  };
}

export const AUDIO_LIBRARY = createAudioLibrary();

export function sfxIds(library = AUDIO_LIBRARY) {
  return library.sfx.map(item => item.id);
}

export function bgmIds(library = AUDIO_LIBRARY) {
  return library.bgm.map(item => item.id);
}

export function describeAudioLibrary(library = AUDIO_LIBRARY) {
  return [
    `音效 sfx: ${library.sfx.map(item => `${item.id}(${item.hint})`).join('、')}`,
    `背景音乐 bgm: ${library.bgm.map(item => `${item.id}(${item.hint})`).join('、')}、none(不加音乐)`
  ].join('\n');
}
