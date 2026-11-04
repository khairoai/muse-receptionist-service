/**
 * The receptionist's voice: ElevenLabs Eleven v4 on the Text-to-Dialogue stream, the voice Khairo's live lines use.
 * (Meta has no text-to-speech model, so this is the one non-Meta model in the pipeline.) Streams 16-bit mono PCM, so
 * playback starts on the first chunk, ~0.25 s after the request.
 */
export const TTS_SAMPLE_RATE = 24_000;
const DEFAULT_MODEL = "eleven_v4_turbo";

export interface ElevenLabsVoice {
  apiKey: string;
  voiceId: string;
  model?: string;
}

/** The voice from the env, or null when ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID aren't set. */
export function voiceFromEnv(): ElevenLabsVoice | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;
  return { apiKey, voiceId, model: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL };
}

/** Yields the line as PCM chunks (whole samples) as they arrive. */
export async function* speak(voice: ElevenLabsVoice, text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=pcm_${TTS_SAMPLE_RATE}`, {
    method: "POST",
    headers: { "xi-api-key": voice.apiKey, "content-type": "application/json" },
    body: JSON.stringify({ model_id: voice.model ?? DEFAULT_MODEL, inputs: [{ text, voice_id: voice.voiceId }] }),
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
