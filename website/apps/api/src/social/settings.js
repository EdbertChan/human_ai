// No "@": telemetry property values are refused if they contain one, because
// that is how the redaction gate catches handles and emails.
export const SOCIAL_POLICY_VERSION = "social-v1";

export const CANONICAL_CATEGORIES = Object.freeze(["tone", "language", "respect", "clarity"]);

export const EXCLUDED_TOPICS = Object.freeze([
  "politics",
  "breaking_news",
  "conflict",
  "tragedy",
  "grief",
  "emergency",
  "health",
  "legal",
  "financial_advice",
  "identity",
  "protected_trait",
  "minors",
  "joke",
  "sarcasm",
  "relationships",
  "family",
  "vulnerable_personal"
]);

export const TEMPLATE_VARIANTS = Object.freeze({
  A: 'I’m sorry, I think you mean: “{rewrite}”',
  B: 'Corporate translation: “{rewrite}”'
});

// Operator-facing choices are fixed enums so free-form human text can never
// reach the PostHog/Slack redaction gate (which would reject it after state
// had already changed).
export const REJECTION_REASONS = Object.freeze([
  "meaning_changed",
  "too_risky",
  "not_funny",
  "bad_rewrite",
  "wrong_target",
  "stale_source",
  "other"
]);

export const OBJECTION_CLASSES = Object.freeze([
  "explicit_stop",
  "delete_request",
  "negative_reply",
  "dm_complaint",
  "other"
]);

export const PAUSE_REASONS = Object.freeze([
  "manual_kill_switch",
  "objection_threshold",
  "x_budget_exhausted",
  "account_warning",
  "enforcement_notice",
  "other"
]);

export const CANDIDATE_TTL_HOURS = 12;
export const CREATOR_COOLDOWN_DAYS = 7;
export const DAILY_POSTED_CAP = 10;
export const TEXT_RETENTION_DAYS = 30;
export const OBJECTION_PAUSE_THRESHOLD = 2;
export const OBJECTION_WINDOW_HOURS = 24;
export const X_MAX_WEIGHTED_LENGTH = 280;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  pauseReason: "never_enabled",
  enabledCategories: ["tone", "language", "respect"],
  excludedTopics: [...EXCLUDED_TOPICS],
  templateWeights: { A: 50, B: 50 },
  maxSourceAgeHours: CANDIDATE_TTL_HOURS,
  dailyPostedCap: DAILY_POSTED_CAP,
  creatorCooldownDays: CREATOR_COOLDOWN_DAYS,
  postingWindow: { timezone: "America/Los_Angeles", startHour: 9, endHour: 21 },
  scanBatchSize: 5,
  monthlyXBudgetUsd: 25,
  xReadCostUsd: 0.005,
  requiredLanguage: "en",
  minLanguageConfidence: 0.9
});

class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsError";
    this.code = "invalid_settings";
  }
}

export { SettingsError };

function assert(condition, message) {
  if (!condition) throw new SettingsError(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSettings(value) {
  assert(isPlainObject(value), "settings must be an object.");
  const unknown = Object.keys(value).filter((key) => !(key in DEFAULT_SETTINGS));
  assert(unknown.length === 0, `Unknown settings field: ${unknown[0]}.`);

  assert(typeof value.enabled === "boolean", "enabled must be a boolean.");
  assert(value.pauseReason === null || typeof value.pauseReason === "string", "pauseReason must be a string or null.");

  assert(Array.isArray(value.enabledCategories), "enabledCategories must be an array.");
  assert(value.enabledCategories.length > 0, "At least one canonical category must stay enabled.");
  for (const category of value.enabledCategories) {
    assert(CANONICAL_CATEGORIES.includes(category), `Unknown canonical category: ${category}.`);
  }

  assert(Array.isArray(value.excludedTopics), "excludedTopics must be an array.");
  for (const topic of value.excludedTopics) {
    assert(EXCLUDED_TOPICS.includes(topic), `Unknown excluded topic: ${topic}.`);
  }

  assert(isPlainObject(value.templateWeights), "templateWeights must be an object.");
  const weightKeys = Object.keys(value.templateWeights).sort();
  assert(weightKeys.join(",") === "A,B", "templateWeights must define exactly A and B.");
  for (const key of weightKeys) {
    const weight = value.templateWeights[key];
    assert(Number.isInteger(weight) && weight >= 0 && weight <= 100, "template weights must be integers 0-100.");
  }
  assert(value.templateWeights.A + value.templateWeights.B === 100, "template weights must sum to 100.");

  assert(
    Number.isInteger(value.maxSourceAgeHours) && value.maxSourceAgeHours > 0 && value.maxSourceAgeHours <= CANDIDATE_TTL_HOURS,
    `maxSourceAgeHours must be 1-${CANDIDATE_TTL_HOURS}.`
  );
  assert(
    Number.isInteger(value.dailyPostedCap) && value.dailyPostedCap >= 0 && value.dailyPostedCap <= DAILY_POSTED_CAP,
    `dailyPostedCap must be 0-${DAILY_POSTED_CAP}.`
  );
  assert(
    Number.isInteger(value.creatorCooldownDays) && value.creatorCooldownDays >= CREATOR_COOLDOWN_DAYS,
    `creatorCooldownDays must be at least ${CREATOR_COOLDOWN_DAYS}.`
  );

  assert(isPlainObject(value.postingWindow), "postingWindow must be an object.");
  assert(value.postingWindow.timezone === "America/Los_Angeles", "postingWindow.timezone must be America/Los_Angeles.");
  assert(Number.isInteger(value.postingWindow.startHour), "postingWindow.startHour must be an integer.");
  assert(Number.isInteger(value.postingWindow.endHour), "postingWindow.endHour must be an integer.");
  assert(
    value.postingWindow.startHour >= 0 && value.postingWindow.startHour < value.postingWindow.endHour && value.postingWindow.endHour <= 24,
    "postingWindow hours must satisfy 0 <= start < end <= 24."
  );

  assert(Number.isInteger(value.scanBatchSize) && value.scanBatchSize > 0 && value.scanBatchSize <= 25, "scanBatchSize must be 1-25.");
  assert(
    typeof value.monthlyXBudgetUsd === "number" && value.monthlyXBudgetUsd > 0 && value.monthlyXBudgetUsd <= 100,
    "monthlyXBudgetUsd must be greater than 0 and at most 100."
  );
  assert(typeof value.xReadCostUsd === "number" && value.xReadCostUsd > 0, "xReadCostUsd must be greater than 0.");
  assert(value.requiredLanguage === "en", "requiredLanguage must be en in v1.");
  assert(
    typeof value.minLanguageConfidence === "number" && value.minLanguageConfidence >= 0 && value.minLanguageConfidence <= 1,
    "minLanguageConfidence must be 0-1."
  );
  return value;
}

export function mergeSettings(current, patch) {
  assert(isPlainObject(patch), "settings patch must be an object.");
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    assert(key in DEFAULT_SETTINGS, `Unknown settings field: ${key}.`);
    merged[key] = isPlainObject(value) ? { ...current[key], ...value } : value;
  }
  return validateSettings(merged);
}

export function renderTemplate(variant, rewrite) {
  const template = TEMPLATE_VARIANTS[variant];
  if (!template) throw new SettingsError(`Unknown template variant: ${variant}.`);
  return template.replace("{rewrite}", () => rewrite);
}
