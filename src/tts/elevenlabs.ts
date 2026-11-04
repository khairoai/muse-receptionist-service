/**
 * The receptionist's voice: ElevenLabs Eleven v4 on the Text-to-Dialogue stream, the voice Khairo's live lines use.
 * (Meta has no text-to-speech model, so this is the one non-Meta model in the pipeline.) Streams 16-bit mono PCM, so
 * playback starts on the first chunk, ~0.25 s after the request.
 */
export const TTS_SAMPLE_RATE = 24_000;
const DEFAULT_MODEL = "eleven_v4_turbo";

/**
 * Eleven v4 has no speed setting, so the pace is a standing direction before every line, as on Khairo's live lines.
 * Measured on this voice: one 30-word reply took 9.8–9.9 s plain, 8.7–9.0 s with "brisk, natural phone pace", 8.4–8.5 s
 * with "quick, brisk phone pace".
 */
const DEFAULT_DIRECTION = "brisk, natural phone pace";
/** A little below the 0.5 default for livelier delivery (production's setting). */
const STABILITY = 0.45;

export interface ElevenLabsVoice {
  apiKey: string;
  voiceId: string;
  model?: string;
  /** Said to the voice before each line, without brackets; empty: none. */
  direction?: string;
}

/** The voice from the env, or null when ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID aren't set. */
export function voiceFromEnv(): ElevenLabsVoice | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;
  return { apiKey, voiceId, model: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL, direction: process.env.ELEVENLABS_DIRECTION?.trim() ?? DEFAULT_DIRECTION };
}

/** Yields the line as PCM chunks (whole samples) as they arrive. */
export async function* speak(voice: ElevenLabsVoice, text: string, signal?: AbortSignal, sampleRate: number = TTS_SAMPLE_RATE): AsyncGenerator<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=pcm_${sampleRate}`, {
    method: "POST",
    headers: { "xi-api-key": voice.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model_id: voice.model ?? DEFAULT_MODEL,
      inputs: [{ text: voice.direction ? `[${voice.direction}] ${text}` : text, voice_id: voice.voiceId }],
      settings: { stability: STABILITY },
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // A chunk can end mid-sample: carry the odd byte to the next one
  let carry = Buffer.alloc(0);
  for await (const chunk of res.body) {
    const bytes = Buffer.concat([carry, Buffer.from(chunk)]);
    const whole = bytes.length - (bytes.length % 2);
    carry = bytes.subarray(whole);
    if (whole) yield bytes.subarray(0, whole);
  }
}
