import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkSetup, maskSecret } from '../src/setup.js';

test('maskSecret never echoes the full key', () => {
  assert.deepEqual(maskSecret(''), { set: false, preview: null });
  assert.deepEqual(maskSecret('   '), { set: false, preview: null });
  const masked = maskSecret('sk-abcdefghijklmnopqrstuv');
  assert.equal(masked.set, true);
  assert.equal(masked.preview, '…stuv');
  assert.ok(!String(masked.preview).includes('sk-abcd'));
});

test('checkSetup reports missing required keys without leaking values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, '# skill\n');
  const report = checkSetup({
    env: { LLM_API_KEY: 'sk-secret-value-AAAA', VECTCUT_API_KEY: '', LLM_MODEL: 'gemini-x' },
    envFileExists: false,
    skillPath
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingRequired, ['VECTCUT_API_KEY']);
  const llm = report.secrets.find(item => item.key === 'LLM_API_KEY');
  assert.equal(llm.set, true);
  assert.equal(llm.preview, '…AAAA');
  assert.ok(!JSON.stringify(report).includes('sk-secret-value'));
  assert.equal(report.publicConfig.LLM_MODEL, 'gemini-x');
  assert.equal(report.skill.present, true);
});
