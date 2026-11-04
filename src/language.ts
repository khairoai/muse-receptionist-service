/**
 * The language of a caller's words from the letters they are written in, for receptionists whose languages each have
 * their own script (Bulgarian in Cyrillic, English in Latin). Instant and without a model, so the reply to a caller's
 * first English words is already in English.
 *
 * This works because Muse Voice Transcribe code-switches: English speech on a stream biased to Bulgarian comes back as
 * English text, so the call can follow the caller without reopening the stream. (Deepgram on `bg` turns the same
 * English into Cyrillic noise.) Copied unchanged from our production voice service.
 */
/** Script code ("Cyrl", "Latn") → the one agent language written in it; null when two of them share a script. */
export function scriptsOf(languages: readonly string[]): ReadonlyMap<string, string> | null {
  const byScript = new Map<string, string>();
  for (const language of languages) {
    let script: string | undefined;
    try {
      script = new Intl.Locale(language).maximize().script;
    } catch {
      return null;
    }
    if (!script || byScript.has(script)) return null;
    byScript.set(script, language);
  }
  return byScript.size > 1 ? byScript : null;
}

/** Letters per agent language in `text` (letters of other scripts and digits are not counted). */
export function lettersByLanguage(text: string, scripts: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [script, language] of scripts) counts.set(language, text.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0);
  return counts;
}

/** The turn without email and web addresses, whose letters are Latin in any language ("ivan.petrov@gmail.com"). */
export function withoutAddresses(text: string): string {
  return text.replace(/\S*@\S*|\S*:\/\/\S*|\S+\.\p{L}{2,}\S*/gu, " ");
}

/** Words of two or more letters in `text`: "BMW" is one, "C" in "C Class" and "320" are none. */
export function wordCount(text: string): number {
  return text.match(/\p{L}{2,}/gu)?.length ?? 0;
}

export interface TurnLetters {
  /** Letters of each agent language's script in the caller's turn (bg → 26, en → 3 for "Имам BMW, искам смяна…"). */
  letters: ReadonlyMap<string, number>;
  /** The turn's words of two or more letters (wordCount). */
  words: number;
  /** The call's language now. */
  current: string;
  /** The caller's first turn of the call. */
  firstTurn: boolean;
}

/** Share of a turn's letters that must be in the other script. */
const SCRIPT_SHARE = 0.8;
/** Words a turn needs to switch the call: on the caller's first turn, and later. */
const WORDS_TO_SWITCH = { first: 2, later: 4 };

/**
 * The language the caller is speaking, or null to keep the call's current one. Callers mix: a Bulgarian caller names a
 * car ("BMW", "Opel Astra", "Mercedes Benz C Class"), a plate or an email in Latin letters, and an English caller may
 * say a Bulgarian street name in Cyrillic ("Улица Витоша"). So a switch needs most of the turn's letters in the other
 * script, and words, not letters: a caller shows their language in their first words ("Yes, please", "Hi, do you speak
 * English?"), while later in the call a short turn in the other script is most likely a name. The same in both
 * directions: a wrong switch to English already needs that evidence, and the caller's next sentence undoes it.
 */
export function decideLanguage(t: TurnLetters): string | null {
  let total = 0;
  let top: [string, number] | null = null;
  for (const [language, n] of t.letters) {
    total += n;
    if (!top || n > top[1]) top = [language, n];
  }
  if (!top || top[0] === t.current || top[1] < SCRIPT_SHARE * total) return null;
  const needed = t.firstTurn ? WORDS_TO_SWITCH.first : WORDS_TO_SWITCH.later;
  return t.words >= needed ? top[0] : null;
}
