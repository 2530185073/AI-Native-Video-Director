import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SKILL_PATH } from './director/prompt.js';

const SECRET_KEYS = [
  { key: 'LLM_API_KEY', needed: 'required', for: '导演决策 / 开拍前看素材 / 审片；默认也用于生图' },
  { key: 'VECTCUT_API_KEY', needed: 'required', for: '建草稿、上传、云渲染（--dry-run 可暂不填）' },
  { key: 'GROQ_API_KEY', needed: 'recommended', for: '逐字时间轴；不填则落到 VectCut ASR' },
  { key: 'IMAGE_API_KEY', needed: 'optional', for: '生图单独一把钥匙；不填则复用 LLM_API_KEY' }
];

const PUBLIC_KEYS = [
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'IMAGE_PROVIDER',
  'IMAGE_MODEL',
  'ASR_PROVIDER',
  'VECTCUT_BASE_URL',
  'BGM_URL'
];

function hasValue(env, key) {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0;
}

/** Never echo a secret. Only say whether it is set, plus a 4-char tail for ops. */
export function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return { set: false, preview: null };
  const tail = text.length >= 8 ? text.slice(-4) : null;
  return { set: true, preview: tail ? `…${tail}` : 'set' };
}

function binOk(name, extraArgs = ['-version']) {
  const result = spawnSync(name, extraArgs, { encoding: 'utf8' });
  if (result.error) return false;
  return result.status === 0;
}

/**
 * What another machine needs before it can cut. Secrets stay in `.env` on that
 * machine — they are never written into the skill pack.
 */
export function checkSetup({ env = process.env, envFileExists = existsSync('.env'), skillPath = SKILL_PATH } = {}) {
  const secrets = SECRET_KEYS.map(item => ({
    ...item,
    ...maskSecret(env[item.key])
  }));
  const missingRequired = secrets.filter(item => item.needed === 'required' && !item.set).map(item => item.key);
  const missingRecommended = secrets.filter(item => item.needed === 'recommended' && !item.set).map(item => item.key);
  const publicConfig = Object.fromEntries(PUBLIC_KEYS.map(key => [key, env[key] || null]));
  const tools = {
    node: process.version,
    ffmpeg: binOk(env.FFMPEG_PATH || 'ffmpeg', ['-version']),
    ffprobe: binOk(env.FFPROBE_PATH || 'ffprobe', ['-version']),
    curl: binOk(env.CURL_PATH || 'curl', ['--version'])
  };
  const skill = { path: skillPath, present: existsSync(skillPath) };
  const ok = missingRequired.length === 0 && skill.present;
  return {
    ok,
    envFileExists,
    secrets,
    missingRequired,
    missingRecommended,
    publicConfig,
    tools,
    skill,
    note: 'API key 只放各机 .env，不要写进 skills/。拷仓库后复制 .env 或按 .env.example 另填一把钥匙即可。'
  };
}
