// Every iOS product event shares one property allowlist: identifiers and
// bounded enum-ish values only, never draft or rewrite text.
const PRODUCT_EVENT_PROPERTIES = Object.freeze([
  "persona",
  "persona_id",
  "available",
  "variant",
  "policy_version",
  "error_code",
  "status"
]);

export const SOCIAL_EVENTS = Object.freeze({
  "social post scanned": ["campaign", "creator_bucket", "source_age_minutes", "policy_version"],
  "social candidate skipped": ["campaign", "skip_reason", "category", "risk_class", "policy_version", "creator_bucket"],
  "social rewrite queued": ["campaign", "template_variant", "category", "creator_bucket", "queue_expiry_minutes"],
  "social draft rejected": ["campaign", "reason", "template_variant", "operator_role"],
  "social reply composer opened": ["campaign", "template_variant", "source_age_minutes", "queue_latency_minutes"],
  "social reply posted": [
    "campaign",
    "template_variant",
    "category",
    "creator_bucket",
    "reply_age_minutes",
    "protocol_deviation"
  ],
  "social reply engagement synced": [
    "campaign",
    "template_variant",
    "creator_bucket",
    "impressions",
    "likes",
    "replies",
    "reposts",
    "quotes",
    "hours_since_post"
  ],
  "social creator objected": ["campaign", "reply_age_minutes", "template_variant", "objection_class", "creator_bucket"],
  "social campaign paused": ["campaign", "reason", "recent_objection_count", "error_signature"],
  "desktop installed": ["campaign_attribution_id", "install_channel"],
  "first rewrite accepted": ["campaign_attribution_id", "install_channel"],
  // iOS product events, relayed through /v1/events and the server-side
  // rewrite hooks. Property values still pass assertRedactedValue, so
  // policy_version strings must use "-" instead of "@" ("corporate-v1").
  ios_app_opened: PRODUCT_EVENT_PROPERTIES,
  keyboard_session_started: PRODUCT_EVENT_PROPERTIES,
  keyboard_enabled: PRODUCT_EVENT_PROPERTIES,
  persona_tapped: PRODUCT_EVENT_PROPERTIES,
  persona_requested: PRODUCT_EVENT_PROPERTIES,
  rewrite_requested: PRODUCT_EVENT_PROPERTIES,
  rewrite_succeeded: PRODUCT_EVENT_PROPERTIES,
  rewrite_failed: PRODUCT_EVENT_PROPERTIES,
  rewrite_sent: PRODUCT_EVENT_PROPERTIES,
  rewrite_cancelled: PRODUCT_EVENT_PROPERTIES
});

export class TelemetryRedactionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelemetryRedactionError";
    this.code = "telemetry_redaction";
  }
}

const MAX_STRING_LENGTH = 64;

// The safety invariant is that no raw tweet text, handle, name, or reply body
// can leave through analytics or Slack. Rather than trusting call sites, every
// outbound string is forced through this shape: short, no whitespace, no "@",
// no URL. Free-form human text cannot survive it.
export function assertRedactedValue(key, value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TelemetryRedactionError(`${key} must be a finite number.`);
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new TelemetryRedactionError(`${key} must be a string, number, boolean, or null.`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new TelemetryRedactionError(`${key} exceeds ${MAX_STRING_LENGTH} characters; it may contain raw text.`);
  }
  if (/\s/.test(value)) {
    throw new TelemetryRedactionError(`${key} contains whitespace; it may contain raw text.`);
  }
  if (value.includes("@")) {
    throw new TelemetryRedactionError(`${key} contains "@"; it may contain a handle or email.`);
  }
  if (/https?:\/\//i.test(value)) {
    throw new TelemetryRedactionError(`${key} contains a URL.`);
  }
  return value;
}

export function buildSocialEvent({ name, distinctId, properties = {} }) {
  const allowed = SOCIAL_EVENTS[name];
  if (!allowed) throw new TelemetryRedactionError(`Unknown social event: ${name}.`);
  assertRedactedValue("distinct_id", distinctId);

  const safeProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) {
      throw new TelemetryRedactionError(`Property ${key} is not allowed on "${name}".`);
    }
    safeProperties[key] = assertRedactedValue(key, value);
  }

  return {
    event: name,
    distinct_id: distinctId,
    properties: {
      ...safeProperties,
      $process_person_profile: false,
      $geoip_disable: true
    }
  };
}

export const SLACK_MESSAGES = Object.freeze({
  draft_queued: ["candidate_id", "template_variant", "category", "creator_bucket", "expires_in_minutes"],
  campaign_paused: ["reason", "recent_objection_count", "error_signature"],
  creator_objected: ["candidate_id", "objection_class", "creator_bucket"],
  budget_threshold: ["threshold_percent", "month", "estimated_spend_usd"],
  job_failed: ["kind", "failure_signature", "attempt_count"],
  deletion_required: ["candidate_id", "reason"]
});

export function buildSlackNotification({ kind, fields = {} }) {
  const allowed = SLACK_MESSAGES[kind];
  if (!allowed) throw new TelemetryRedactionError(`Unknown Slack notification: ${kind}.`);
  const safeFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) {
      throw new TelemetryRedactionError(`Field ${key} is not allowed on Slack notification "${kind}".`);
    }
    safeFields[key] = assertRedactedValue(key, value);
  }
  const summary = Object.entries(safeFields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return { kind, fields: safeFields, text: `EmapthyAi social: ${kind} ${summary}`.trim() };
}
