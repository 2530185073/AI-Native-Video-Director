import { normalizeWords, wordsDuration } from '../timeline/words.js';
import { alignWithExternalService } from './external.js';
import { alignWithVectCut } from './vectcut.js';
import { transcribeWithGroq } from './whisper.js';

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

  if (chosen === 'vectcut') {
    const result = await alignWithVectCut({ audioUrl, script, logger, ...vectcut });
    return { provider: 'vectcut', words: result.words, duration: wordsDuration(result.words), raw: result.raw, transcript: result.transcript };
  }

  if (chosen === 'groq') {
    const result = await transcribeWithGroq({ audioUrl, language, prompt: script, ...groq });
    const normalized = normalizeWords(result.words);
    if (!normalized.length) throw new Error('Whisper returned no word timestamps');
    return { provider: 'groq', words: normalized, duration: result.duration || wordsDuration(normalized), raw: result.raw };
  }

  throw new Error(`Unknown ASR provider: ${chosen}`);
}
