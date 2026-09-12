const MAX_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 4000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export class ElevenLabsProviderError extends Error {
  constructor(status, message = "ElevenLabs request failed.") {
    super(message);
    this.name = "ElevenLabsProviderError";
    this.status = Number.isInteger(status) ? status : 502;
  }
}

function checkKey(apiKey) {
  if (!apiKey) throw new ElevenLabsProviderError(503, "ElevenLabs is not configured.");
}

function providerFailure(response) {
  if (response.status === 401 || response.status === 403) {
    return new ElevenLabsProviderError(response.status, "Voice cloning unavailable for this account.");
  }
  if (response.status === 400) {
    return new ElevenLabsProviderError(response.status, "ElevenLabs rejected the audio sample. Use a playable 10–30 second recording with clear speech.");
  }
  return new ElevenLabsProviderError(response.status);
}

export async function createVoice({ name, audio, mimeType = "audio/m4a", apiKey, fetchImpl = fetch } = {}) {
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) throw new TypeError("name is required and bounded.");
  if (!(audio instanceof Blob) && !(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio)) throw new TypeError("audio is required.");
  const bytes = audio instanceof Blob ? audio.size : audio.byteLength;
  if (!bytes || bytes > MAX_AUDIO_BYTES) throw new TypeError("audio is empty or too large.");
  checkKey(apiKey);
  const form = new FormData();
  form.append("name", name.trim());
  const blob = audio instanceof Blob ? audio : new Blob([audio], { type: mimeType });
  form.append("files", blob, `sample.${mimeType.split("/")[1] || "audio"}`);
  let response;
  try { response = await fetchImpl("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": apiKey }, body: form }); }
  catch { throw new ElevenLabsProviderError(502); }
  if (!response.ok) throw providerFailure(response);
  const payload = await response.json();
  if (typeof payload.voice_id !== "string" || !payload.voice_id) throw new ElevenLabsProviderError(502);
  return payload.voice_id;
}

export async function synthesizeSpeech({ voiceId = DEFAULT_VOICE_ID, text, apiKey, modelId, model, voiceSettings, fetchImpl = fetch } = {}) {
  if (typeof voiceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)) throw new TypeError("voiceId is invalid.");
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) throw new TypeError("text is required and bounded.");
  checkKey(apiKey);
  let response;
  const body = { text: text.trim(), model_id: model ?? modelId ?? "eleven_multilingual_v2" };
  if (voiceSettings) body.voice_settings = voiceSettings;
  try { response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, { method: "POST", headers: { "xi-api-key": apiKey, accept: "audio/mpeg", "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new ElevenLabsProviderError(502); }
  if (!response.ok) throw providerFailure(response);
  return { audio: await response.arrayBuffer(), contentType: response.headers?.get?.("content-type") || "audio/mpeg" };
}

export const synthesizeWithElevenLabs = async (options) => (await synthesizeSpeech({ ...options, modelId: options?.model ?? options?.modelId })).audio;
export const ELEVENLABS_LIMITS = { maxNameLength: MAX_NAME_LENGTH, maxTextLength: MAX_TEXT_LENGTH, maxAudioBytes: MAX_AUDIO_BYTES };
