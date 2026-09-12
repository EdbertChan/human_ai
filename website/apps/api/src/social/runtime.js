import { defaultRewrite, providerModel, selectProvider } from "../app.js";
import { PERSONAS } from "../personas.js";
import { parseEncryptionKey } from "../crypto.js";
import { loadSocialConfig } from "./config.js";
import { classifyWithOpenAI } from "./classifier.js";
import { createReadOnlyXClient } from "./x-read-only.js";

export function createSocialDependencies(env = process.env, { store, fetchImpl = fetch } = {}) {
  const config = loadSocialConfig(env);
  const encryptionKey = env.EMPATHY_RUN_ENCRYPTION_KEY ? parseEncryptionKey(env.EMPATHY_RUN_ENCRYPTION_KEY) : null;

  const createXClient = config.x.bearerToken
    ? () => createReadOnlyXClient({ bearerToken: config.x.bearerToken, fetchImpl })
    : null;

  const classify = env.OPENAI_API_KEY
    ? ({ text }) => classifyWithOpenAI({
      text,
      apiKey: env.OPENAI_API_KEY,
      model: env.SOCIAL_CLASSIFIER_MODEL ?? env.OPENAI_MODEL ?? "gpt-5-nano",
      fetchImpl
    })
    : null;

  // The claude-code provider spawns a local CLI, which may not exist inside a
  // serverless runtime; without an HTTP provider key the cron must report
  // dependencies_unavailable instead of burning job attempts on spawn errors.
  const provider = selectProvider(env);
  const rewriteApiKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : null;
  const rewrite = rewriteApiKey
    ? ({ text }) => defaultRewrite(provider)({
      text,
      context: {},
      apiKey: rewriteApiKey,
      model: providerModel(provider, env),
      systemPrompt: PERSONAS.corporate.systemPrompt,
      policyVersion: PERSONAS.corporate.version
    })
    : null;

  return { config, encryptionKey, store, createXClient, classify, rewrite, fetchImpl };
}
