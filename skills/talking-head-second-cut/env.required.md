# 另一台机器要备的钥匙（只写变量名，不写值）

**Skill 包里没有、也不会有任何 API key。** `SKILL.md` 只有剪辑规则和词表。钥匙放在**那台机器自己的 `.env`**，且 `.env` 已被 git 忽略。

## 必填（要出草稿 / 成片）

| 变量 | 干什么 |
| --- | --- |
| `LLM_API_KEY` | 导演、看素材、审片；默认也用来生 B-roll |
| `VECTCUT_API_KEY` | 建草稿、上传、云渲染 |

## 建议填

| 变量 | 干什么 |
| --- | --- |
| `GROQ_API_KEY` | 逐字时间轴（不填会落到 VectCut ASR，更慢也更贵） |

## 可选

| 变量 | 干什么 |
| --- | --- |
| `IMAGE_API_KEY` / `IMAGE_BASE_URL` | 生图单独走另一套接口；不填则复用 `LLM_*` |
| `LLM_BASE_URL` / `LLM_MODEL` | 中转站或换模型 |
| `BGM_URL` | 强制垫乐；空则用产品默认 `talk_default` |

完整空白模板：仓库根目录 `.env.example`。

## 只让别的模型出方案（不出片）

只拷 `skills/talking-head-second-cut/` 即可，**不需要 key**。对方输出 `plan.json`，再拿到装好 `.env` 的机器上 `--from-plan`。
