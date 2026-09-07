# 口播二次剪辑：外部经验调研与落地记录

> 2026-09 两轮联网调研（中文口播课程/拆解、海外 talking-head 剪辑方法论、字幕与留存研究、开源 agentic 剪辑项目、Agent Skill 仓库）的结论，以及每条结论在本仓库里落到了哪一层。技能本体见 [`skills/talking-head-second-cut/SKILL.md`](../skills/talking-head-second-cut/SKILL.md)。

## 1. 各方共识（跨来源重复出现的结论）

| # | 结论 | 来源类型 | 落地 |
| --- | --- | --- | --- |
| 1 | **前 3 秒决定完播**，“黄金三秒、白金一秒”；第一帧就要有视觉信息（大字/重点词），首镜头短于 1.5 秒的视频 3 秒留存高 18-25% | 国内口播脚本教程 ×4、Viral Roast 节奏分析 | 首句 punch 提前到第一帧（`HOOK_PUNCH_LATEST`）；节奏预算里明确“片段 1 应有 punch” |
| 2 | **打断（pattern interrupt）要挂在叙事转折上，不是按秒表撒**；同类刺激 6 秒后被大脑习惯化，“第 14 个 whoosh 什么都不是” | Creator Lane、Prepublish Playbook、AutoClip | SKILL 第 0 节心法 + 第 1 节决策流程；lint 相邻推镜 ≥2.5s 间隔、同句只 1 个 punch |
| 3 | **剪辑节奏越快，持续观看越低**（N=242 的 2×3 对照实验，20 秒 talking-head）；匀速快切 15-20 秒后疲劳 | Marketing Trends Congress 2026 论文、Viral Roast | 密度上限保留；新增 B-roll 占比 ≤35%；SKILL 反模式清单 |
| 4 | **推镜 10-20%、至少保持 3-4 秒、40 秒 3-4 次是上限、不在前 0.5 秒推、快推慢放** | AutoClip punch-in 指南、Prepublish、Pippit | lint `minZoomSeconds=2`（不足则延到下一句）、`minZoomGapSeconds=2.5`；compiler 推入 0.25s / 回落 0.6s |
| 5 | **B-roll 2-4 秒、占 20-30%、前 3 秒不切、金句前切回人脸**；不足 2 秒像故障、超 5 秒观众忘了有人在说话 | AutoClip、Zella、ProPixel、Cursa 课程 | lint `hookSeconds=3` 内全屏图降级为 card_top；`minFullscreenSeconds=2` 不足降 lower_card；`maxBrollRatio` |
| 6 | **口播 12-25 秒是掉人最多的“死中段”**，用 B-roll 或轻推救，不是再加花字 | AutoClip | 用户提示里点名死中段片段 id；lint 对 >8 秒无变化的段落补 1.08 轻推（`STATIC_FILL_REASON` 标注） |
| 7 | **字幕是 ROI 最高的“打断”**：有字幕完播 +80-85%（85% 静音刷）；逐词/短句高亮 > 整句静态；一屏 1-3 个重点词、高饱和黄 `#FFD93D` 做视觉锚点 | Ascynd、Blitzcut（含 OpusClip 1350 万条语料）、Verizon/Publicis 2019 | 已有逐字对齐 + 高亮预算；SKILL 明确“高亮词是扫一眼就懂的锚点” |
| 8 | **字幕放在画面 60-70% 高度**（避开底部 UI），竖屏每行 6-12 字，描边 2-3px，底部留 10-15% | Ascynd、剪映排版帖 ×3 | `SAFE_ZONE.bottom=0.16`，`bottom` 位置上收到 0.81；lower_third 上限 0.80 |
| 9 | **抖音安全区**：顶部 ~150-200px 标签栏、底部 ~300px 文案/作者/音乐、右侧 ~120px 互动栏（1080×1920） | 色彩韵、TrueSight 尺寸规范 | `SAFE_ZONE = { top 0.06, bottom 0.16, right 0.115, left 0.05 }`：top punch、card_top、pip_side 全部按此收边 |
| 10 | **屏幕上有东西出现就配一个很轻的音效**，音效要有语法（whoosh 给切换、pop 给弹出、ding 给数字） | Ali Abdaal、hotclip 音效指南 | lint `sfxByBeatType`：错配自动改正（zoom 上的 whoosh 删除、punch 上的 whoosh → pop、broll 上的 ding → whoosh） |
| 11 | **Plan → Render → Reviewer 的闭环**是 agentic 剪辑项目的共同架构：Reviewer 看成片打分、低于阈值回灌 Director | agentic-video-editor（Gemini Reviewer 五维）、cutible（VLM QC gate）、Orkas-VideoStudio（promise-check） | `src/review.js`：抽帧（hook / 每个 beat / 中段 / 结尾）→ contact-sheet.jpg → Gemini 视觉打分 review.json（`--review`） |
| 12 | **技能应当是可读、可 diff 的文档**（SKILL.md），而不是散落在代码里的 prompt 字符串 | Orkas `@orkas/video-studio-skills`、agency-agents-zh | `skills/talking-head-second-cut/SKILL.md` 即导演系统提示（去掉 front-matter 与来源节） |

## 2. 与现有实现的差距（调研前 → 后）

| 项目 | 之前 | 现在 |
| --- | --- | --- |
| 系统提示 | 10 条经验性规则，散在 `prompt.js` | 有决策流程（读结构 → 定风格 → 排 hook → 排变化点 → 救死中段 → 收尾 → 做减法）、每类组件硬指标、反模式清单的 SKILL |
| 节奏 | 只有每分钟上限 | 上限 + 下限（静止段兜底）+ 间隔（推镜）+ 占比（B-roll）+ 首 3 秒保护 |
| 位置 | 只保证不遮脸 | 不遮脸 + 不进平台 UI 遮挡区 |
| 声音 | 提示词里写了对应关系 | lint 强制的音效语法 |
| 质检 | `query_script` 校验草稿结构 | + 成片抽帧拼图 + 视觉审片（hook / 可读性 / 遮脸 / 安全区 / 节奏 / 风格一致，附带按秒数的修法） |

## 3. 有意没采纳的

- **ALL-CAPS / Montserrat Black 风格**：英文特有，中文无大小写；对应的“字重 + 描边 + 高饱和高亮”已经在字幕样式里。
- **逐词 karaoke 字幕**：我们已有逐字时间戳，可以做；但中文知识口播里“整句 + 1-2 个高亮词”比逐词跳更利于阅读（眼动研究：字幕速度上去后回忆准确率下降），保留为可选方向。
- **每 2-4 秒一刀的“短视频节奏”**：多篇数据指向这会降低持续观看；数字人素材也没有多机位，可用的是推镜和 B-roll，不是硬切。
- **Prepublish 的 45-90 秒打断间隔**：那是 10 分钟 YouTube 长视频的参数，30-60 秒口播不适用。

## 4. 主要来源

- 海螺社《口播稿怎么写：钩子+价值+行动》、迅课《短视频口播脚本实用攻略》、人人都是自媒体《2026 爆款脚本实战》、翔宇工作流《10 个爆款口播公式》
- Creator Lane《Pattern Interrupts: When They Boost Retention and When They Break It》(2026)
- Prepublish《YouTube Pattern Interrupts: 14 Tips》《7 Visual Pattern Interrupts for Post》
- Dost & Huang, *Jump-cut style and transition frequency in short-form talking-head video*, Marketing Trends Congress 2026
- Viral Roast《Video Editing Rhythm》《Video Pacing & Retention》
- AutoClip《How to Use Punch-In Zoom》《Punch-In, Crop, and Speaker Zoom》《How to Add B-Roll Overlays》
- Zella《What Is B-Roll》、ProPixel《B-Roll Guide》、Cursa《B-Roll and Cutaways》、CutFast《J Cut and L Cut》
- Ascynd《Why Hormozi Captions Get More Views》、Blitzcut《Word-by-Word vs Full-Sentence Captions 2026》、Karadeo
- Szarkowska et al., subtitle speed eye-tracking (UEA); *Journal of Vision* 26(6) closed-caption gaze study
- 色彩韵《抖音视频尺寸 2026》《全平台封面尺寸速查》、TrueSight 抖音长宽比解析
- 剪映字幕预设/分行断句排版帖、agency-agents-zh《短视频剪辑教练》
- Ali Abdaal《The Ultimate Guide to YouTube》
- GitHub：Orkas-AI/Orkas-VideoStudio、plokdalberb-byte/cutible、lamardealmaker/agentic-video-editor、univa-agent/univa
- 商业产品功能参照：Submagic（Magic Zoom 四种曲线、B-roll 频率滑杆）、OpusClip、剪映智能包装
