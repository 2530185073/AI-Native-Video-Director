# 导演词表（只能从这里选，名称 / ID 一字不差）

本表与 `src/director/catalog.js`、`src/director/audio.js` 同步。模型输出里出现表外的名字，校验会拒绝。

## tone

`energetic` `authoritative` `friendly` `storytelling` `playful` `urgent`

## bgm.track

| id | 何时选 |
| --- | --- |
| `talk_default` | **默认**。知识 / 干货 / 带货 / 生活都可用 |
| `lofi_clean` | 更理性干货（本仓库会回落到 `talk_default`） |
| `soft_pad` | 情感 / 故事 / 慢节奏 |
| `none` | 片子本身有音乐，或极其严肃 |

## 字幕 font / position

- font：`新青年体`（产品锁定，写了别的也会被改回）
- position：`lower_third`（默认）`center_low` `bottom`
- 入场 `subtitleStyle.intro`：`弹入` `向上滑动` `向下飞入` `渐显` `放大` `缩小` `打字机_I` `逐字显影` `弹簧` `甩出` `故障打字机` `弹性伸缩` `闪动` `冲屏位移`，或 `null`

产品锁定：字号 13、白字、黑描边 40@40、`transformY=-0.4`、`background.enabled=false`。你只需定 `highlightColor`、`highlightScale`、`intro`。

## punch

- position：`above_head`（默认）`top`（近景稳妥，不叠字幕）`beside_face` `center`（0.6–1.2s 爆点）— **不要用 `chest`**
- intro：同上文字入场
- outro：`渐隐` `向上滑动` `缩小` `溶解` `闪动` `弹出`，或 `null`
- loop：`轻微跳动` `跳动` `晃动` `颤抖` `闪烁` `扫光` `摇摆` `故障闪动` `呐喊`，或 `null`
- color（无花字时）：`#FFFFFF` 或 `subtitleStyle.highlightColor`

### flowerId

| id | 名称 | 色系 | 何时用 |
| --- | --- | --- | --- |
| `W0FmRVRXQV1EZ1JRS11BbEBWVQ==` | 金色金属质感立体花字 | yellow | 价格、价值 |
| `W0BpSlRRRldCZlhQTFpAaERcUw==` | 黄色花字 | yellow | 通用重点，网感最强 |
| `WklvQVJSR1FAalxTTFtObUFVUw==` | 综艺黄色描边花字 | yellow | 综艺、吐槽 |
| `WkhtRF1QQlNBZllSTFlMZktSUg==` | 综艺 白色 | white | 干净综艺 |
| `WkprRFxVRVxEaV1TQFlIakRUVQ==` | 系统故障字 | multi | 科技、反差 |
| `W0BuQldSQFZCbllUSVVJZkVVVA==` | 潮酷金黄色发光霓虹灯牌花字 | yellow | 潮酷 |
| `WkpuRFxRQlBNalpSS19IaUNSVg==` | 知识-花字 | blue | 只配蓝色强调色 |
| `W0BmQFNaQVJBbFlRTVlLbkBdUA==` | 红色花字 | red | 警告、禁止 |
| `W0BtRFRVQlRAa19XSFpBa0tWUQ==` | 简约黑色描边立体花字 | white | 专业稳重，任何强调色都能配 |
| `WktrQVNSR1FDaFJXQFVObUVcVA==` | 小清新绿色描边花字 | green | 健康、省钱 |
| `W0FmRVRQSlZGb15QT1RJbEVcUA==` | 蓝色斜向跳色花字 | blue | 科技、数据 |
| `WkhpQ1BaRF1Bal1dT1RAbkJRUw==` | 潮酷发光立体花字 | multi | 开场 hook |
| `WkppQVJWS1RNbFlVQFtMa0ZcUg==` | 纸纹底手写纹理花字 | neutral | 文艺、故事 |
| `Wk1vRFZWQFJGb1NUTFVKaUdRUA==` | 火焰立体 | red | 爆款、燃 |

彩色花字必须和 `highlightColor` 同色系，否则系统会换掉。全片 1–2 种。

## broll

- layout：`pip_face`（近景首选）`fullscreen` `card_top` `pip_side` `lower_card`
- imageIntro：`放大` `动感放大` `轻微放大` `渐显` `向上滑动` `向下滑动` `向左滑动` `向右滑动` `向下甩入` `旋转开幕` `抖动下降`
- outro：`缩小` `向上滑动` `向下滑动` `向左滑动` `向右滑动` `轻微放大` `跳转闭幕`

prompt 写画面：主体、构图、光线、风格，并写「画面中不要出现任何文字」。

## effect.name

`变焦推镜` `镜头变焦` `色差故障` `电影感画幅` `模糊开幕` `渐隐闭幕` `星光` `放大镜`

## sfx（挂在 beat 上）

| id | 挂在 |
| --- | --- |
| `pop` | punch 默认 |
| `ding` | 价格 / 数字 / 金句 |
| `error` | 警告 / 避坑 |
| `success` | 结论 / 正确做法 |
| `click` | 列表逐条 |
| `whoosh` | 全屏图 / 切卡 |
| `whoosh_soft` | 故事 / 轻推 |

punch 不要挂 whoosh；zoom 通常不加，要加只用 `whoosh_soft`。
