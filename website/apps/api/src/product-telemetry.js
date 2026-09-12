import { randomUUID } from "node:crypto";
import { assertRedactedValue, buildSocialEvent } from "./social/events.js";
import { enqueuePostHogEvent } from "./social/outbox.js";

// Generic iOS product-event relay. install-telemetry.js only models two
// fixed install stages; this module carries the keyboard/app usage funnel
// with the same durable-outbox-first, direct-capture-fallback delivery.
export const PRODUCT_EVENT_NAMES = Object.freeze([
  "ios_app_opened",
  "keyboard_session_started",
  "keyboard_enabled",
  "persona_tapped",
  "persona_requested",
  "rewrite_requested",
  "rewrite_succeeded",
  "rewrite_failed",
  "rewrite_sent",
  "rewrite_cancelled"
]);

// Same safe shape as install IDs: lowercase-hex UUID material only, so a
// distinct ID can never smuggle an email, handle, or free text.
const SAFE_ID = /^[a-f0-9-]{16,64}$/;

const ALLOWED_EVENT_KEYS = new Set(["distinctId", "name", "properties", "eventId"]);

// Property keys are allowlisted here AND per-event in SOCIAL_EVENTS; the
// values themselves must still pass assertRedactedValue (short, no
// whitespace, no "@", no URLs), so raw draft/rewrite text cannot survive.
const ALLOWED_PROPERTY_KEYS = new Set([
  "persona",
  "persona_id",
  "available",
  "variant",
  "policy_version",
  "error_code",
  "status"
]);

export function isValidDistinctId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}

export function validateProductEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    if (!ALLOWED_EVENT_KEYS.has(key)) return false;
  }
  if (!isValidDistinctId(value.distinctId)) return false;
  if (!PRODUCT_EVENT_NAMES.includes(value.name)) return false;
  if (value.eventId !== undefined && (typeof value.eventId !== "string" || !SAFE_ID.test(value.eventId))) return false;
  if (value.properties !== undefined) {
    if (typeof value.properties !== "object" || value.properties === null || Array.isArray(value.properties)) return false;
    for (const [key, propertyValue] of Object.entries(value.properties)) {
      if (propertyValue === undefined) continue;
      if (!ALLOWED_PROPERTY_KEYS.has(key)) return false;
      try {
        assertRedactedValue(key, propertyValue);
      } catch {
        // Rejected input is the expected outcome here: the caller returns
        // 400 and never touches PostHog, so there is nothing to recover.
        return false;
      }
    }
  }
  return true;
}

// Durable path: same at-least-once outbox delivery as install events. The
// eventId keeps distinct occurrences of the same event name apart while the
// deterministic uuid still deduplicates redelivery of one occurrence.
export async function enqueueProductEvent(store, { distinctId, name, properties, eventId }) {
  return enqueuePostHogEvent(store, {
    name,
    distinctId,
    properties,
    idempotencyKey: `ios:${distinctId}:${name}:${eventId ?? randomUUID()}`
  });
}

export async function captureProductEvent({
  distinctId,
  name,
  properties,
  projectToken,
  host = "https://us.i.posthog.com",
  fetchImpl = fetch
}) {
  if (!projectToken) return;
  const payload = buildSocialEvent({ name, distinctId, properties });
  const response = await fetchImpl(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: projectToken, ...payload })
  });
  if (!response.ok) {
    throw new Error(`PostHog capture failed (${response.status}).`);
  }
}

export const EMPATHY_FLAG_KEY = "emapthyai-empathy-access";
export const CONVERSATION_CONTEXT_FLAG_KEY = "emapthyai-conversation-context";

export async function evaluateFeatureFlag({
  flagKey,
  distinctId,
  projectToken,
  host = "https://us.i.posthog.com",
  fetchImpl = fetch
}) {
  if (!projectToken) return "locked";
  try {
    const response = await fetchImpl(`${host.replace(/\/$/, "")}/decide?v=4`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: projectToken, distinct_id: distinctId })
    });
    if (!response.ok) return "locked";
    const body = await response.json();
    const value = body?.flags?.[flagKey]?.variant
      ?? body?.flags?.[flagKey]?.enabled
      ?? body?.flags?.[flagKey]
      ?? body?.featureFlags?.[flagKey];
    // PostHog may return a named variant or a boolean flag. Normalize both
    // forms here so persona and capability authorization share one contract.
    return value === "available" || value === true || value === "true"
      ? "available"
      : "locked"
  } catch (error) {
    console.error("[product-telemetry] feature flag lookup failed; defaulting to locked", {
      flagKey,
      message: error.message
    });
    return "locked";
  }
}

export async function evaluateEmpathyAccess(args) {
  return evaluateFeatureFlag({ ...args, flagKey: EMPATHY_FLAG_KEY });
}
