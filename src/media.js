import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

export function isLocalFile(value) {
  if (!value || /^https?:\/\//i.test(String(value))) return false;
  try { return statSync(String(value)).isFile(); } catch { return false; }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

/**
 * Extract the narration track from a local video as mp3 (needs ffmpeg on PATH).
 * Returns null when ffmpeg is unavailable so callers can fall back to sending the
 * video itself to the ASR (Whisper accepts mp4).
 */
export async function extractAudio(videoPath, { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', outputPath } = {}) {
  const target = outputPath || join(tmpdir(), `${basename(videoPath, extname(videoPath))}-${Date.now()}.mp3`);
  try {
    await run(ffmpeg, ['-v', 'error', '-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'libmp3lame', '-q:a', '4', target]);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return existsSync(target) ? target : null;
}

const CONTENT_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };

/**
 * Make local media usable by the cloud services: upload the video (and the
 * extracted / provided audio) to VectCut temporary storage and return public URLs.
 * Remote URLs pass through untouched.
 */
export async function resolveMedia({ video, audio, client, logger = () => {}, extract = extractAudio }) {
  const result = { videoUrl: video, audioUrl: audio, uploads: [] };
  if (!isLocalFile(video) && !isLocalFile(audio)) return result;
  if (!client) throw new Error('a VectCut client (VECTCUT_API_KEY) is required to upload local media files');

  const upload = async path => {
    const uploaded = await client.uploadTemporaryFile({ fileName: basename(path), bytes: readFileSync(path), contentType: CONTENT_TYPES[extname(path).toLowerCase()] || 'application/octet-stream' });
    result.uploads.push({ path, url: uploaded.url, expiresAt: uploaded.expiresAt });
    logger(`uploaded ${basename(path)} (${(statSync(path).size / 1048576).toFixed(1)} MB), link expires ${uploaded.expiresAt || 'later'}`);
    return uploaded.url;
  };

  if (isLocalFile(video)) {
    if (!audio) {
      const extracted = await extract(video);
      if (extracted) {
        logger(`extracted narration audio → ${extracted}`);
        result.audioUrl = await upload(extracted);
      } else {
        logger('ffmpeg not found; the ASR will read the video file directly');
      }
    }
    result.videoUrl = await upload(video);
  }
  if (isLocalFile(audio)) result.audioUrl = await upload(audio);
  return result;
}
