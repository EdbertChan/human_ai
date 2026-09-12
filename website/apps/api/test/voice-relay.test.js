import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/app.js";

const handler = createHandler({ NODE_ENV: "test" });

test("voice relay returns the uploaded audio and corporate persona", async () => {
  const input = new Uint8Array([0, 1, 2, 250, 255]);
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "corporate");
  form.set("audio", new File([input], "voice.m4a", { type: "audio/mp4" }));

  const response = await handler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.persona, "corporate");
  assert.equal(body.audioContentType, "audio/mp4");
  assert.deepEqual([...Buffer.from(body.audio, "base64")], [...input]);
});

test("voice relay rejects a non-corporate persona", async () => {
  const form = new FormData();
  form.set("distinctId", "0123456789abcdef0123456789abcdef");
  form.set("persona", "empathetic");
  form.set("audio", new File([new Uint8Array([1])], "voice.m4a", { type: "audio/mp4" }));

  const response = await handler(new Request("https://example.test/v1/voice/relay", { method: "POST", body: form }));
  assert.equal(response.status, 400);
});
