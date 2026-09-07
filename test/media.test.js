import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalFile, resolveMedia } from '../src/media.js';

function mockUploader() {
  const uploads = [];
  return {
    uploads,
    async uploadTemporaryFile({ fileName, bytes, contentType }) {
      uploads.push({ fileName, size: bytes.length, contentType });
      return { url: `https://tmp.test/${fileName}`, expiresAt: '2026-09-08T00:00:00Z' };
    }
  };
}

test('remote URLs pass through resolveMedia untouched', async () => {
  const result = await resolveMedia({ video: 'https://cdn.test/a.mp4', audio: 'https://cdn.test/a.mp3', client: null });
  assert.deepEqual(result, { videoUrl: 'https://cdn.test/a.mp4', audioUrl: 'https://cdn.test/a.mp3', uploads: [] });
  assert.equal(isLocalFile('https://cdn.test/a.mp4'), false);
  assert.equal(isLocalFile('D:\\a\\missing.mp4'), false);
});

test('local video is uploaded and its audio extracted + uploaded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-'));
  const video = join(dir, 'take1.mp4');
  writeFileSync(video, Buffer.alloc(16, 1));
  const extractedPath = join(dir, 'take1.mp3');
  const client = mockUploader();
  const logs = [];
  const result = await resolveMedia({
    video,
    client,
    logger: message => logs.push(message),
    extract: async () => { writeFileSync(extractedPath, Buffer.alloc(8, 2)); return extractedPath; }
  });
  assert.equal(result.videoUrl, 'https://tmp.test/take1.mp4');
  assert.equal(result.audioUrl, 'https://tmp.test/take1.mp3');
  assert.deepEqual(client.uploads.map(item => item.contentType), ['audio/mpeg', 'video/mp4']);
  assert.equal(result.uploads.length, 2);
  assert.ok(logs.some(line => line.includes('extracted')));
});

test('without ffmpeg the video URL doubles as ASR input; local files need a client', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-'));
  const video = join(dir, 'take2.mp4');
  writeFileSync(video, Buffer.alloc(4));
  const client = mockUploader();
  const result = await resolveMedia({ video, client, extract: async () => null });
  assert.equal(result.videoUrl, 'https://tmp.test/take2.mp4');
  assert.equal(result.audioUrl, undefined);
  await assert.rejects(resolveMedia({ video, client: null, extract: async () => null }), /VECTCUT_API_KEY/);
});
