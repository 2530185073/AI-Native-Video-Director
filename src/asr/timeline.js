import { normalizeWords, wordsDuration } from '../timeline/words.js';
import { alignWithExternalService } from './external.js';
import { transcribeWithGroq } from './whisper.js';

/**
 * Resolve a word-level timeline for the narration using whichever source is
 * available, in priority order:
 *
 * 1. `words` passed inline (already-aligned data from the caller)
 * 2. the user's external alignment service (`ASR_PROVIDER=external`)
 * 3. Groq Whisper with the script as a prompt (`ASR_PROVIDER=groq`)
 */
export async function getWordTimeline({
  audioUrl,
  script,
  language = 'zh',
  words,
  provider = process.env.ASR_PROVIDER || 'auto',
  external = {},
  groq = {}
} = {}) {
  if (words) {
    const normalized = normalizeWords(words);
    if (!normalized.length) throw new Error('inline words could not be parsed into a timeline');
    return { provider: 'inline', words: normalized, duration: wordsDuration(normalized) };
  }

  let chosen = provider;
  if (chosen === 'auto') {
    if (process.env.ASR_ALIGN_URL) chosen = 'external';
    else if (process.env.GROQ_API_KEY) chosen = 'groq';
    else throw new Error('No ASR provider configured: set ASR_ALIGN_URL (external) or GROQ_API_KEY (groq), or pass words');
  }

  if (chosen === 'external') {
    const result = await alignWithExternalService({ audioUrl, script, language, ...external });
    return { provider: 'external', words: result.words, duration: wordsDuration(result.words), raw: result.raw };
  }

  if (chosen === 'groq') {
    const result = await transcribeWithGroq({ audioUrl, language, prompt: script, ...groq });
    const normalized = normalizeWords(result.words);
    if (!normalized.length) throw new Error('Whisper returned no word timestamps');
    return { provider: 'groq', words: normalized, duration: result.duration || wordsDuration(normalized), raw: result.raw };
  }

  throw new Error(`Unknown ASR provider: ${chosen}`);
}
