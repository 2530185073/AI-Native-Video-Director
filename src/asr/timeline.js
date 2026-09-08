import { normalizeWords, wordsDuration } from '../timeline/words.js';
import { alignScriptCharacters } from './alignment.js';
import { alignWithExternalService } from './external.js';
import { alignWithVectCut } from './vectcut.js';
import { DEFAULT_GROQ_WHISPER_MODEL, transcribeWithGroq } from './whisper.js';

export const DEFAULT_MIN_COVERAGE = 0.6;

/**
 * What to hand Whisper as `prompt`. Feeding the whole script makes Groq's
 * large-v3 hallucinate on some clips (observed: a 39s narration transcribed as
 * unrelated filler), so the default is no prompt at all; the script is matched
 * afterwards by character-level alignment anyway.
 *
 *   GROQ_WHISPER_PROMPT=          → none (default)
 *   GROQ_WHISPER_PROMPT=script    → full script
 *   GROQ_WHISPER_PROMPT=<text>    → literal hint (e.g. a few domain terms)
 */
export function whisperPromptFor(script, mode = process.env.GROQ_WHISPER_PROMPT) {
  const value = String(mode || '').trim();
  if (!value || value === 'none') return undefined;
  if (value === 'script') return script;
  return value;
}

function coverageAgainst(script, words) {
  if (!script) return 1;
  return alignScriptCharacters(script, words).exactCoverage;
}

/**
 * Transcribe with Groq and verify the result against the script; when the
 * transcript barely matches (hallucination, wrong language, broken audio), retry
 * once with the turbo model. Returns the best attempt with its coverage.
 */
export async function transcribeWithGroqVerified({ audioUrl, script, language, groq = {}, minCoverage = DEFAULT_MIN_COVERAGE, logger = () => {} }) {
  const { prompt: explicitPrompt, model: explicitModel, ...rest } = groq;
  const prompt = explicitPrompt !== undefined ? explicitPrompt : whisperPromptFor(script);
  const primary = explicitModel || process.env.GROQ_WHISPER_MODEL || DEFAULT_GROQ_WHISPER_MODEL;
  const attempts = [{ model: primary, prompt }];
  const retryModel = primary.includes('turbo') ? 'whisper-large-v3' : 'whisper-large-v3-turbo';
  attempts.push({ model: retryModel, prompt: undefined });

  let best = null;
  for (const [index, attempt] of attempts.entries()) {
    const result = await transcribeWithGroq({ audioUrl, language, ...rest, model: attempt.model, prompt: attempt.prompt });
    const words = normalizeWords(result.words);
    if (!words.length) continue;
    const coverage = coverageAgainst(script, words);
    const candidate = { provider: 'groq', words, duration: result.duration || wordsDuration(words), raw: result.raw, coverage, model: attempt.model };
    if (!best || coverage > best.coverage) best = candidate;
    if (coverage >= minCoverage) return candidate;
    logger(`whisper attempt ${index + 1} (${attempt.model}${attempt.prompt ? ', with prompt' : ''}) matched ${Math.round(coverage * 100)}% of the script: "${String(result.raw?.text || '').slice(0, 40)}…"`);
  }
  if (!best) throw new Error('Whisper returned no word timestamps');
  return best;
}

/**
 * Resolve a word-level timeline for the narration using whichever source is
 * available, in priority order:
 *
 * 1. `words` passed inline (already-aligned data from the caller)
 * 2. Groq Whisper word timestamps + local character-level alignment against the
 *    script (`ASR_PROVIDER=groq`) — the proven default of this repo
 * 3. the user's external alignment service (`ASR_PROVIDER=external`)
 * 4. VectCut's ASR in script-alignment mode (`ASR_PROVIDER=vectcut`, needs the client)
 */
export async function getWordTimeline({
  audioUrl,
  script,
  language = 'zh',
  words,
  provider = process.env.ASR_PROVIDER || 'auto',
  external = {},
  vectcut = {},
  groq = {},
  minCoverage = Number(process.env.ASR_MIN_COVERAGE) || DEFAULT_MIN_COVERAGE,
  logger = () => {}
} = {}) {
  if (words) {
    const normalized = normalizeWords(words);
    if (!normalized.length) throw new Error('inline words could not be parsed into a timeline');
    return { provider: 'inline', words: normalized, duration: wordsDuration(normalized) };
  }

  let chosen = provider;
  if (chosen === 'auto') {
    if (process.env.GROQ_API_KEY || groq.apiKey) chosen = 'groq';
    else if (process.env.ASR_ALIGN_URL || external.url) chosen = 'external';
    else if (vectcut.client) chosen = 'vectcut';
    else throw new Error('No ASR provider configured: set GROQ_API_KEY (groq), ASR_ALIGN_URL (external) or VECTCUT_API_KEY (vectcut), or pass words');
  }

  if (chosen === 'external') {
    const result = await alignWithExternalService({ audioUrl, script, language, ...external });
    return { provider: 'external', words: result.words, duration: wordsDuration(result.words), raw: result.raw };
  }

  if (chosen === 'groq') {
    const groqResult = await transcribeWithGroqVerified({ audioUrl, script, language, groq, minCoverage, logger });
    if (groqResult.coverage >= minCoverage || !vectcut.client) {
      if (groqResult.coverage < minCoverage) logger(`warning: whisper transcript matches only ${Math.round(groqResult.coverage * 100)}% of the script; subtitle timing will be partly interpolated`);
      return groqResult;
    }
    logger(`whisper transcript matches only ${Math.round(groqResult.coverage * 100)}% of the script; falling back to VectCut script alignment`);
    chosen = 'vectcut';
  }

  if (chosen === 'vectcut') {
    if (!vectcut.client) throw new Error('ASR_PROVIDER=vectcut needs a VectCut client (VECTCUT_API_KEY)');
    const result = await alignWithVectCut({ audioUrl, script, logger, ...vectcut });
    return { provider: 'vectcut', words: result.words, duration: wordsDuration(result.words), raw: result.raw, transcript: result.transcript };
  }

  throw new Error(`Unknown ASR provider: ${chosen}`);
}
