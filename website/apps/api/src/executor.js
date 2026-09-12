import { checkInbound, assertOutbound, InvariantError } from "./invariants.js";
import { encryptJson, decryptJson } from "./crypto.js";
import { logRedactedAudit } from "./audit.js";

export const RUN_TTL_MS = 10 * 60 * 1000;
export const STUCK_PROCESSING_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 2;

export class DurableConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DurableConfigError";
    this.code = "durable_not_configured";
  }
}

export class RewriteExecutionError extends Error {
  constructor(code, message = "Rewrite failed.") {
    super(message);
    this.name = "RewriteExecutionError";
    this.code = code;
  }
}

export async function executeRewrite({
  body,
  resolvedPersona,
  rewrite,
  apiKey,
  model,
  store,
  encryptionKey,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  audit = logRedactedAudit,
  now = () => Date.now(),
  onPartial,
  revokeUnvalidatedPreview
}) {
  if (!store || !encryptionKey) {
    throw new DurableConfigError("Durable rewrite requires DATABASE_URL and EMPATHY_RUN_ENCRYPTION_KEY.");
  }

  const inboundError = checkInbound(body);
  if (inboundError) {
    throw new InvariantError("inbound_invalid", inboundError);
  }

  const started = now();
  const expiresAt = new Date(started + RUN_TTL_MS);
  const payload = encryptJson(encryptionKey, {
    text: body.text,
    context: body.context ?? {},
    persona: body.persona ?? null,
    customization: body.customization ?? null,
    resolvedVersion: resolvedPersona.version
  });

  const { id: runId } = await store.createPending({
    personaVersion: resolvedPersona.version,
    payload,
    expiresAt
  });

  const claimed = await store.claim(runId);
  if (!claimed) {
    await store.markFailed(runId, "claim_failed");
    audit({
      runId,
      personaVersion: resolvedPersona.version,
      status: "failed",
      errorCode: "claim_failed",
      attemptCount: 0,
      durationMs: now() - started
    });
    throw new RewriteExecutionError("claim_failed");
  }

  let attempt = claimed.attempt_count;
  let lastErrorCode = "provider_failed";
  let providerName = null;
  let decrypted;

  try {
    decrypted = decryptJson(encryptionKey, {
      ciphertext: claimed.payload_ciphertext,
      iv: claimed.payload_iv,
      tag: claimed.payload_tag
    });
  } catch {
    await store.markFailed(runId, "decrypt_failed");
    audit({
      runId,
      personaVersion: resolvedPersona.version,
      status: "failed",
      errorCode: "decrypt_failed",
      attemptCount: attempt,
      durationMs: now() - started
    });
    throw new RewriteExecutionError("decrypt_failed");
  }

  while (attempt <= maxAttempts) {
    try {
      const result = await rewrite({
        text: decrypted.text,
        context: decrypted.context,
        apiKey,
        model,
        systemPrompt: resolvedPersona.systemPrompt,
        policyVersion: resolvedPersona.version,
        ...(onPartial ? { onPartial } : {})
      });

      assertOutbound(result, {
        text: decrypted.text,
        policyVersion: resolvedPersona.version
      });

      providerName = result.provider;
      const resultCipher = encryptJson(encryptionKey, result);
      await store.markCompleted(runId, resultCipher);

      audit({
        runId,
        personaVersion: resolvedPersona.version,
        provider: providerName,
        status: "completed",
        attemptCount: attempt,
        durationMs: now() - started,
        categoryLabels: result.categories
      });

      return result;
    } catch (error) {
      revokeUnvalidatedPreview?.();
      if (error instanceof InvariantError && error.code === "outbound_invalid") {
        lastErrorCode = "outbound_invalid";
        await store.markFailed(runId, lastErrorCode);
        audit({
          runId,
          personaVersion: resolvedPersona.version,
          provider: providerName,
          status: "failed",
          errorCode: lastErrorCode,
          attemptCount: attempt,
          durationMs: now() - started
        });
        throw new RewriteExecutionError(lastErrorCode);
      }
      lastErrorCode = "provider_failed";
      if (attempt >= maxAttempts) break;
      attempt += 1;
    }
  }

  await store.markFailed(runId, lastErrorCode);
  audit({
    runId,
    personaVersion: resolvedPersona.version,
    provider: providerName,
    status: "failed",
    errorCode: lastErrorCode,
    attemptCount: attempt,
    durationMs: now() - started
  });
  throw new RewriteExecutionError(lastErrorCode);
}

export async function maintainRuns(store, { stuckOlderThanMs = STUCK_PROCESSING_MS } = {}) {
  const reclaimed = await store.reclaimStuck({ olderThanMs: stuckOlderThanMs });
  const deleted = await store.deleteExpired();
  return { reclaimed, deleted };
}
