import { GeminiLLM, createGeminiLLM, resolveGeminiBaseUrl, toGeminiSchema, GEMINI_NATIVE_BASE_URL } from './gemini.js';
import { OpenAICompatibleLLM, createLLM as createOpenAICompatibleLLM, extractJson, simplifySchema, GEMINI_OPENAI_BASE_URL } from './openai-compatible.js';

/**
 * Build the configured LLM. Default is Gemini's native `generateContent` API
 * (LLM_PROVIDER=gemini). Set LLM_PROVIDER=openai-compatible to keep the old path.
 */
export function createLLM(options = {}) {
  const provider = String(options.provider || process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'openai' || provider === 'openai-compatible') {
    return createOpenAICompatibleLLM(options);
  }
  if (provider === 'gemini' || provider === 'google' || provider === 'gemini-native') {
    return createGeminiLLM(options);
  }
  throw new Error(`Unknown LLM_PROVIDER "${provider}" (use gemini or openai-compatible)`);
}

export {
  GeminiLLM,
  createGeminiLLM,
  resolveGeminiBaseUrl,
  toGeminiSchema,
  GEMINI_NATIVE_BASE_URL,
  OpenAICompatibleLLM,
  createOpenAICompatibleLLM,
  extractJson,
  simplifySchema,
  GEMINI_OPENAI_BASE_URL
};
