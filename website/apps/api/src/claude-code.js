import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CORPORATE_SYSTEM_PROMPT, formatRewriteInput, logLlmRequestIfEnabled, normalizeModelResult } from "./llm.js";
import { PERSONAS } from "./personas.js";

const execFileAsync = promisify(execFile);
const JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    acceptable: { type: "boolean" },
    categories: { type: "array", items: { type: "string" } },
    replacement: { type: "string" }
  },
  required: ["acceptable", "categories", "replacement"],
  additionalProperties: false
});

export async function rewriteWithClaudeCode({
  text,
  context,
  model = "sonnet",
  systemPrompt = CORPORATE_SYSTEM_PROMPT,
  policyVersion = PERSONAS.corporate.version,
  exec = execFileAsync
}) {
  logLlmRequestIfEnabled({ provider: "claude-code", model, text });
  const inputText = formatRewriteInput(text, context?.conversation);
  const { stdout } = await exec("claude", [
    "-p",
    "--no-session-persistence",
    "--setting-sources", "",
    "--tools", "",
    "--model", model,
    "--output-format", "json",
    "--json-schema", JSON_SCHEMA,
    "--system-prompt", systemPrompt,
    inputText
  ], { timeout: 35_000, maxBuffer: 1_000_000 });

  const envelope = JSON.parse(stdout);
  if (envelope.is_error) throw new Error(envelope.result || "Claude Code rewrite failed.");
  const parsed = envelope.structured_output ?? JSON.parse(envelope.result);
  return normalizeModelResult(parsed, text, "claude-code", policyVersion);
}
