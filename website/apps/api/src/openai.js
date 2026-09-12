import { CORPORATE_SYSTEM_PROMPT, formatRewriteInput, logLlmRequestIfEnabled, normalizeModelResult, parseJsonText } from "./llm.js";
import { PERSONAS } from "./personas.js";

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new Error("The model response did not contain output text.");
}

const REWRITE_SCHEMA = {
  type: "object",
  properties: {
    acceptable: { type: "boolean" },
    categories: { type: "array", items: { type: "string" } },
    replacement: { type: "string" }
  },
  required: ["acceptable", "categories", "replacement"],
  additionalProperties: false
};

export async function rewriteWithOpenAI({
  text,
  context,
  apiKey,
  model,
  systemPrompt = CORPORATE_SYSTEM_PROMPT,
  policyVersion = PERSONAS.corporate.version,
  fetchImpl = fetch
}) {
  logLlmRequestIfEnabled({ provider: "openai", model, text });
  const inputText = formatRewriteInput(text, context?.conversation);
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: "rewrite_result",
          strict: true,
          schema: REWRITE_SCHEMA
        }
      },
      store: false,
      input: [
        {
          role: "developer",
          content: systemPrompt
        },
        {
          role: "user",
          content: inputText
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }

  return normalizeModelResult(parseJsonText(extractOutputText(await response.json())), text, "openai", policyVersion);
}
