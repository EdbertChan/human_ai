import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/app.js";
import { synthesizeSpeechWithOpenAI } from "../src/openai.js";

const relayCalls = [];
const handler = createHandler({ NODE_ENV: "test", OPENAI_API_KEY: "openai-test" }, {
  transcribeAudio: async ({ audio }) => { relayCalls.push({ kind: "transcribe", bytes: audio.size }); return "this is shit"; },
  voiceRewrite: async ({ text, resolvedPersona, systemPrompt }) => {
    relayCalls.push({ kind: "rewrite", text, persona: resolvedPersona.id, systemPrompt });
    return { replacement: `${resolvedPersona.id} transformed voice` };
  },
  synthesizeSpeech: async ({ text, tone, voice, model }) => {
    relayCalls.push({ kind: "synthesize", text, tone, voice, model });
    return { audio: new Uint8Array([9, 8, 7]), contentType: "audio/mpeg" };
  }
});

test("voice relay transforms and returns the requested persona", async () => {
  const input = new Uint8Array([0, 1, 2, 250, 255]);
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "corporate");
  form.set("audio", new File([input], "voice.m4a", { type: "audio/mp4" }));

  const response = await handler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.persona, "corporate");
  assert.equal(body.audioContentType, "audio/mpeg");
  assert.equal(body.transcript, "this is shit");
  assert.equal(body.replacement, "corporate transformed voice");
  assert.deepEqual([...Buffer.from(body.audio, "base64")], [9, 8, 7]);
});

test("voice relay uses the cloned ElevenLabs voice and persona settings when configured", async () => {
  let elevenRequest;
  const elevenHandler = createHandler({ NODE_ENV: "test", OPENAI_API_KEY: "openai-test", ELEVENLABS_API_KEY: "eleven-test", ELEVENLABS_MODEL: "eleven_multilingual_v2" }, {
    transcribeAudio: async () => "this is shit",
    voiceRewrite: async () => ({ replacement: "corporate transformed voice" }),
    synthesizeElevenLabs: async (options) => { elevenRequest = options; return { audio: new Uint8Array([5, 4, 3]), contentType: "audio/mpeg" }; }
  });
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "corporate");
  form.set("voiceId", "cloned_voice_123");
  form.set("audio", new File([new Uint8Array([1, 2])], "voice.m4a", { type: "audio/mp4" }));

  const response = await elevenHandler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  assert.equal(elevenRequest.voiceId, "cloned_voice_123");
  assert.equal(elevenRequest.model, "eleven_multilingual_v2");
  assert.equal(elevenRequest.voiceSettings.stability, 0.72);
  assert.equal(elevenRequest.voiceSettings.style, 0.08);
});

test("voice relay transforms warm voice with the warm policy", async () => {
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "warm");
  form.set("audio", new File([new Uint8Array([1, 2, 3])], "voice.m4a", { type: "audio/mp4" }));

  const response = await handler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.persona, "warm");
  assert.equal(body.policyVersion, "warm@v1");
  assert.equal(body.replacement, "warm transformed voice");
  assert.deepEqual([...Buffer.from(body.audio, "base64")], [9, 8, 7]);
  assert.deepEqual(relayCalls.slice(-3).map(({ kind }) => kind), ["transcribe", "rewrite", "synthesize"]);
  assert.match(relayCalls.at(-2).systemPrompt, /warm writing reviewer/i);
});

test("voice relay rejects an unsupported persona", async () => {
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "empathetic");
  form.set("audio", new File([new Uint8Array([1])], "voice.m4a", { type: "audio/mp4" }));

  const response = await handler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 400);
});

test("text-to-speech preserves the draft and uses the fingerprint", async () => {
  let speechRequest;
  const textHandler = createHandler({ NODE_ENV: "test", ELEVENLABS_API_KEY: "eleven-test" }, {
    synthesizeElevenLabs: async (options) => { speechRequest = options; return { audio: new Uint8Array([6, 6, 6]), contentType: "audio/mpeg" }; }
  });
  const draft = "this app is shit";
  const speakResponse = await textHandler(new Request("https://example.test/v1/voice/speak", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: draft, persona: "corporate", distinctId: "0123456789abcdef0123456789abcdef", voiceId: "cloned_voice_123" })
  }));
  assert.equal(speakResponse.status, 200);
  const spoken = await speakResponse.json();
  assert.equal(spoken.persona, "corporate");
  assert.deepEqual([...Buffer.from(spoken.audio, "base64")], [6, 6, 6]);
  assert.equal(speechRequest.text, draft);
  assert.equal(speechRequest.voiceId, "cloned_voice_123");
});

test("translation returns OpenAI audio when a tone is requested", async () => {
  const input = new Uint8Array([73, 68, 51, 4]);
  let rewriteRequest;
  let synthesisRequest;
  const voiceHandler = createHandler(
    { OPENAI_API_KEY: "test-key", OPENAI_TTS_MODEL: "gpt-4o-mini-tts", OPENAI_TTS_VOICE: "coral", NODE_ENV: "test" },
    {
      translateRewrite: async (options) => {
        rewriteRequest = options;
        return { replacement: "Please read this aloud." };
      },
      synthesizeSpeech: async (options) => {
        synthesisRequest = options;
        return { audio: input.buffer, contentType: "audio/mpeg" };
      }
    }
  );

  const response = await voiceHandler(new Request("https://example.test/v1/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Read this", direction: "outgoing", persona: "corporate", tone: "Warm and reassuring" })
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.translation, "Please read this aloud.");
  assert.equal(body.audio, Buffer.from(input).toString("base64"));
  assert.equal(body.audioContentType, "audio/mpeg");
  assert.equal(rewriteRequest.resolvedPersona.id, "corporate");
  assert.equal(synthesisRequest.text, "Please read this aloud.");
  assert.equal(synthesisRequest.tone, "Warm and reassuring");
  assert.equal(synthesisRequest.voice, "coral");
  assert.equal(synthesisRequest.model, "gpt-4o-mini-tts");
});

test("OpenAI speech sends tone instructions and returns audio", async () => {
  const input = new Uint8Array([73, 68, 51, 4]);
  let request;

  const speech = await synthesizeSpeechWithOpenAI({
    text: "Read this aloud",
    tone: "Calm and concise",
    voice: "coral",
    model: "gpt-4o-mini-tts",
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(input, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
  });

  assert.equal(request.url, "https://api.openai.com/v1/audio/speech");
  assert.deepEqual(JSON.parse(request.options.body), {
    model: "gpt-4o-mini-tts",
    input: "Read this aloud",
    voice: "coral",
    instructions: "Calm and concise"
  });
  assert.equal(speech.contentType, "audio/mpeg");
  assert.deepEqual([...new Uint8Array(speech.audio)], [...input]);
});

test("translation rejects an empty tone", async () => {
  const response = await handler(new Request("https://example.test/v1/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Read this", direction: "outgoing", tone: "" })
  }));

  assert.equal(response.status, 400);
});
