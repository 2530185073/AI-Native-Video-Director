/**
 * Curated vocabulary the AI Director is allowed to use.
 *
 * Every name here was checked against VectCut's `get_*_types` responses and is
 * marked `cloud_render_supported: true`, so a plan that only uses this catalog
 * renders in the cloud without silently dropping animations. Descriptions are
 * written for the LLM: they explain *when* an effect fits, not what it looks like.
 */

export const TEXT_INTRO = [
  { name: '弹入', hint: '默认、最百搭，节奏快' },
  { name: '向上滑动', hint: '干净，适合正文字幕' },
  { name: '向下飞入', hint: '强调标题或结论' },
  { name: '渐显', hint: '克制，适合平静或专业语气' },
  { name: '放大', hint: '重点词冲出来' },
  { name: '缩小', hint: '数字、价格砸下来' },
  { name: '打字机_I', hint: '悬念、逐字揭示' },
  { name: '逐字显影', hint: '金句慢慢出现' },
  { name: '弹簧', hint: '轻松、玩梗' },
  { name: '甩出', hint: '情绪爆发' },
  { name: '故障打字机', hint: '科技、反差、吐槽' },
  { name: '弹性伸缩', hint: '口语化、活泼' },
  { name: '闪动', hint: '警告、注意' },
  { name: '冲屏位移', hint: '开场标题' }
];

export const TEXT_OUTRO = [
  { name: '渐隐', hint: '默认' },
  { name: '向上滑动', hint: '与向上滑动入场配套' },
  { name: '缩小', hint: '干脆收掉' },
  { name: '溶解', hint: '柔和' },
  { name: '闪动', hint: '警告结束' },
  { name: '弹出', hint: '活泼' }
];

export const TEXT_LOOP = [
  { name: '轻微跳动', hint: '让重点词一直有呼吸感，低干扰' },
  { name: '跳动', hint: '强调力度更大' },
  { name: '晃动', hint: '不安、紧张、吐槽' },
  { name: '颤抖', hint: '震惊、夸张' },
  { name: '闪烁', hint: '警告、限时' },
  { name: '扫光', hint: '高级、金色、价值感' },
  { name: '摇摆', hint: '轻松玩梗' },
  { name: '故障闪动', hint: '科技、反差' },
  { name: '呐喊', hint: '情绪顶点' }
];

/** 花字 (styled text presets). IDs from the official VectCut mapping table. */
export const FLOWER_TEXT = [
  { id: 'W0FmRVRXQV1EZ1JRS11BbEBWVQ==', name: '金色金属质感立体花字', hint: '价格、价值、高级感' },
  { id: 'W0BpSlRRRldCZlhQTFpAaERcUw==', name: '黄色花字', hint: '通用重点词，网感最强' },
  { id: 'WklvQVJSR1FAalxTTFtObUFVUw==', name: '综艺黄色描边花字', hint: '综艺感、吐槽、反转' },
  { id: 'WkhtRF1QQlNBZllSTFlMZktSUg==', name: '综艺 白色', hint: '干净的综艺字幕' },
  { id: 'WkprRFxVRVxEaV1TQFlIakRUVQ==', name: '系统故障字', hint: '科技、错误、反差' },
  { id: 'W0BuQldSQFZCbllUSVVJZkVVVA==', name: '潮酷金黄色发光霓虹灯牌花字', hint: '潮酷、夜店、年轻' },
  { id: 'WkpuRFxRQlBNalpSS19IaUNSVg==', name: '知识-花字', hint: '知识科普、干货' },
  { id: 'W0BmQFNaQVJBbFlRTVlLbkBdUA==', name: '红色花字', hint: '警告、禁止、亏损' },
  { id: 'W0BtRFRVQlRAa19XSFpBa0tWUQ==', name: '简约黑色描边立体花字', hint: '专业、稳重的重点词' },
  { id: 'WktrQVNSR1FDaFJXQFVObUVcVA==', name: '小清新绿色描边花字', hint: '健康、自然、省钱' },
  { id: 'W0FmRVRQSlZGb15QT1RJbEVcUA==', name: '蓝色斜向跳色花字', hint: '科技、理性、数据' },
  { id: 'WkhpQ1BaRF1Bal1dT1RAbkJRUw==', name: '潮酷发光立体花字', hint: '标题、开场 hook' },
  { id: 'WkppQVJWS1RNbFlVQFtMa0ZcUg==', name: '纸纹底手写纹理花字', hint: '文艺、故事、情感' },
  { id: 'Wk1vRFZWQFJGb1NUTFVKaUdRUA==', name: '火焰立体', hint: '爆款、热销、燃' }
];

export const IMAGE_INTRO = [
  { name: '放大', hint: '默认，B-roll 图片弹出' },
  { name: '动感放大', hint: '更有冲击力' },
  { name: '轻微放大', hint: '克制、专业' },
  { name: '渐显', hint: '柔和' },
  { name: '向上滑动', hint: '从底部升起的信息卡' },
  { name: '向下滑动', hint: '从顶部落下的信息卡' },
  { name: '向左滑动', hint: '右侧画中画进入' },
  { name: '向右滑动', hint: '左侧画中画进入' },
  { name: '向下甩入', hint: '活泼、玩梗' },
  { name: '旋转开幕', hint: '强调' },
  { name: '抖动下降', hint: '砸下来的感觉' }
];

export const IMAGE_OUTRO = [
  { name: '缩小', hint: '默认' },
  { name: '向上滑动', hint: '与滑动入场配套' },
  { name: '向下滑动', hint: '' },
  { name: '向左滑动', hint: '' },
  { name: '向右滑动', hint: '' },
  { name: '轻微放大', hint: '' },
  { name: '跳转闭幕', hint: '干脆' }
];

/**
 * Scene effects are the riskiest category (no cloud flag in the docs), so keep the
 * list short, low-key, and only for moments that truly need a texture change.
 */
export const SCENE_EFFECTS = [
  { name: '变焦推镜', hint: '瞬间推近，配合重点词' },
  { name: '镜头变焦', hint: '轻微呼吸感变焦' },
  { name: '色差故障', hint: '反差、吐槽、转折 0.3-0.6 秒' },
  { name: '电影感画幅', hint: '上下黑边，讲故事或结论段' },
  { name: '模糊开幕', hint: '开场第一秒' },
  { name: '渐隐闭幕', hint: '结尾最后一秒' },
  { name: '星光', hint: '价值感、亮点' },
  { name: '放大镜', hint: '揭秘、看细节' }
];

/** Fonts from `get_font_types` with good Simplified-Chinese coverage. */
export const FONTS = [
  { name: 'SourceHanSansCN_Bold', hint: '思源黑体粗体，最稳的字幕字体' },
  { name: 'HarmonyOS_Sans_SC_Bold', hint: '鸿蒙黑体，现代、干净' },
  { name: 'MiSans_Heavy', hint: '小米黑体特粗，冲击力强，适合重点词' },
  { name: 'ResourceHanRoundedCN_Md', hint: '圆体，亲切、生活化、母婴美食' },
  { name: 'LXGWWenKai_Bold', hint: '霞鹜文楷，人文、故事感' },
  { name: 'SourceHanSerifCN_SemiBold', hint: '思源宋体，高级、知识付费、金融' },
  { name: 'ZY_Vigorous', hint: '有力手写感，运动、燃' }
];

export const SUBTITLE_POSITIONS = [
  { name: 'lower_third', hint: '标准位置：人物下巴以下、画面下 1/4 之上，最常用' },
  { name: 'center_low', hint: '略高于 lower_third，接近人物胸口，节奏快的口播用' },
  { name: 'bottom', hint: '贴近底部，画面上方要留给 B-roll 时用' }
];

export const PUNCH_POSITIONS = [
  { name: 'above_head', hint: '人物头顶上方空白区，默认' },
  { name: 'beside_face', hint: '脸侧空白（自动选择左右）' },
  { name: 'center', hint: '画面正中，盖住人物，只在 0.6-1.2 秒的爆点用' },
  { name: 'top', hint: '画面顶部安全区' }
];

export const BROLL_LAYOUTS = [
  { name: 'card_top', hint: '人物头顶上方的信息卡，人物保持可见，最常用' },
  { name: 'fullscreen', hint: '全屏盖住人物 1.5-4 秒，用于展示商品/案例/对比图' },
  { name: 'pip_side', hint: '脸侧画中画小图，自动选择空白一侧' },
  { name: 'lower_card', hint: '字幕上方一块横卡，适合数据、列表' }
];

export const TONES = ['energetic', 'authoritative', 'friendly', 'storytelling', 'playful', 'urgent'];

export const CATALOG = {
  textIntro: TEXT_INTRO,
  textOutro: TEXT_OUTRO,
  textLoop: TEXT_LOOP,
  flowerText: FLOWER_TEXT,
  imageIntro: IMAGE_INTRO,
  imageOutro: IMAGE_OUTRO,
  sceneEffects: SCENE_EFFECTS,
  fonts: FONTS,
  subtitlePositions: SUBTITLE_POSITIONS,
  punchPositions: PUNCH_POSITIONS,
  brollLayouts: BROLL_LAYOUTS,
  tones: TONES
};

export function names(list) {
  return list.map(item => item.name);
}

export function flowerIds() {
  return FLOWER_TEXT.map(item => item.id);
}

/** Compact, prompt-friendly rendering of the catalog. */
export function describeCatalog(catalog = CATALOG) {
  const line = (title, list, key = 'name') => `${title}: ${list.map(item => `${item[key]}${item.hint ? `(${item.hint})` : ''}`).join('、')}`;
  return [
    line('字幕字体 font', catalog.fonts),
    line('字幕位置 subtitlePosition', catalog.subtitlePositions),
    line('文字入场动画 textIntro', catalog.textIntro),
    line('文字出场动画 textOutro', catalog.textOutro),
    line('文字循环动画 textLoop', catalog.textLoop),
    `花字 flowerId(用 id 引用): ${catalog.flowerText.map(item => `${item.id}=${item.name}(${item.hint})`).join('、')}`,
    line('重点词位置 punchPosition', catalog.punchPositions),
    line('图片入场动画 imageIntro', catalog.imageIntro),
    line('图片出场动画 imageOutro', catalog.imageOutro),
    line('B-roll 布局 brollLayout', catalog.brollLayouts),
    line('场景特效 sceneEffect', catalog.sceneEffects),
    `语气 tone: ${catalog.tones.join('、')}`
  ].join('\n');
}
