import { buildSocialEvent } from "./social/events.js";
import { enqueuePostHogEvent } from "./social/outbox.js";

const EVENT_BY_STAGE = Object.freeze({
  completed: "desktop installed",
  first_rewrite_accepted: "first rewrite accepted"
});

export const INSTALL_CHANNELS = Object.freeze(["x", "chrome_store", "direct", "install_sh", "unknown"]);

const ALLOWED_EVENT_KEYS = new Set(["installId", "stage", "campaignId", "channel"]);

export function validateInstallEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    if (!ALLOWED_EVENT_KEYS.has(key)) return false;
  }
  if (typeof value.installId !== "string" || !/^[a-f0-9-]{16,64}$/.test(value.installId)) return false;
  if (!(value.stage in EVENT_BY_STAGE)) return false;
  if (value.campaignId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(String(value.campaignId))) return false;
  if (value.channel !== undefined && !INSTALL_CHANNELS.includes(value.channel)) return false;
  return true;
}

// Durable path: the event goes through the social outbox and the social cron
// delivers it with retries, so a PostHog outage cannot lose install evidence.
export async function enqueueInstallEvent(store, { installId, stage, campaignId, channel }) {
  return enqueuePostHogEvent(store, {
    name: EVENT_BY_STAGE[stage],
    distinctId: installId,
    idempotencyKey: `install:${installId}:${stage}`,
    properties: { campaign_attribution_id: campaignId, install_channel: channel }
  });
}

export async function captureInstallEvent({
  installId,
  stage,
  campaignId,
  channel,
  projectToken,
  host = "https://us.i.posthog.com",
  fetchImpl = fetch
}) {
  if (!projectToken) return;
  const payload = buildSocialEvent({
    name: EVENT_BY_STAGE[stage],
    distinctId: installId,
    properties: { campaign_attribution_id: campaignId, install_channel: channel }
  });
  const response = await fetchImpl(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: projectToken, ...payload })
  });
  if (!response.ok) {
    throw new Error(`PostHog capture failed (${response.status}).`);
  }
}
