import assert from "node:assert/strict";
import test from "node:test";
import { personaOptions, resolvePersona } from "../src/personas.js";

test("warm persona is available and resolves to its warm policy", () => {
  const warm = personaOptions("empathy_locked").find((option) => option.id === "warm");
  assert.deepEqual(warm, { id: "warm", label: "Warm", available: true, requestable: false });

  const resolved = resolvePersona({ persona: "warm" });
  assert.equal(resolved.id, "warm");
  assert.equal(resolved.version, "warm@v1");
  assert.match(resolved.systemPrompt, /warm writing reviewer/i);
});
