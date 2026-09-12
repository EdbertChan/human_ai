import { createHash } from "node:crypto";
import { buildSlackNotification, buildSocialEvent } from "./events.js";

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

export function backoffFor(attemptCount) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1));
}

// Delivery is at-least-once (a crash between the POST and the delivered mark
// re-sends), so every PostHog event carries a uuid derived from its
// idempotency key and PostHog deduplicates the retry.
export function deterministicEventUuid(value) {
  const hex = createHash("sha256").update(String(value)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function enqueuePostHogEvent(store, { name, distinctId, properties, idempotencyKey }) {
  const payload = {
    ...buildSocialEvent({ name, distinctId, properties }),
    uuid: deterministicEventUuid(`posthog:${idempotencyKey}`)
  };
  return store.enqueueOutboxEvent({
    destination: "posthog",
    idempotencyKey,
    eventName: name,
    payload
  });
}

export async function enqueueSlackNotification(store, { kind, fields, idempotencyKey }) {
  const payload = buildSlackNotification({ kind, fields });
  return store.enqueueOutboxEvent({
    destination: "slack",
    idempotencyKey,
    eventName: kind,
    payload
  });
}

async function sendPostHog(payload, { projectToken, host, fetchImpl }) {
  if (!projectToken) throw new Error("POSTHOG_PROJECT_TOKEN is not configured.");
  const response = await fetchImpl(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: projectToken, ...payload })
  });
  if (!response.ok) throw new Error(`PostHog capture failed (${response.status}).`);
}

async function sendSlack(payload, { webhookUrl, fetchImpl }) {
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL is not configured.");
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: payload.text })
  });
  if (!response.ok) throw new Error(`Slack delivery failed (${response.status}).`);
}

export async function deliverOutbox({ store, config, fetchImpl = fetch, limit = 20, log = console.error }) {
  // An unconfigured destination is not a delivery failure: its rows must stay
  // queued untouched (no attempt burned) until the token/webhook exists,
  // instead of dead-lettering after max_attempts of guaranteed failures.
  const destinations = [];
  if (config.posthog.projectToken) destinations.push("posthog");
  if (config.slack.webhookUrl) destinations.push("slack");
  const waitingDestinations = ["posthog", "slack"].filter((name) => !destinations.includes(name));

  if (destinations.length === 0) {
    return { attempted: 0, delivered: 0, retried: 0, waitingDestinations };
  }

  const claimed = await store.claimOutboxEvents({ limit, destinations });
  const result = { attempted: claimed.length, delivered: 0, retried: 0, waitingDestinations };

  for (const row of claimed) {
    try {
      if (row.destination === "posthog") {
        await sendPostHog(row.payload, { ...config.posthog, fetchImpl });
      } else {
        await sendSlack(row.payload, { ...config.slack, fetchImpl });
      }
      await store.markOutboxDelivered(row.id);
      result.delivered += 1;
    } catch (error) {
      // Never swallow: the outbox row keeps the event, and the log keeps the
      // reason a human needs to diagnose it later.
      log("[social-outbox] delivery failed", {
        id: row.id,
        destination: row.destination,
        event: row.event_name,
        attempt: row.attempt_count,
        message: error.message
      });
      await store.markOutboxFailed(row.id, { error: error.message, backoffMs: backoffFor(row.attempt_count) });
      result.retried += 1;
    }
  }

  return result;
}
