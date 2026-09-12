export const REQUIRED_SOCIAL_ENV = Object.freeze([
  "DATABASE_URL",
  "EMPATHY_RUN_ENCRYPTION_KEY",
  "X_READ_BEARER_TOKEN",
  "X_ACCOUNT_USER_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "SOCIAL_PORTAL_ALLOWED_EMAILS"
]);

export const OPTIONAL_SOCIAL_ENV = Object.freeze([
  "SLACK_WEBHOOK_URL",
  "POSTHOG_PROJECT_TOKEN",
  "POSTHOG_HOST",
  "X_API_SCOPES",
  "X_OAUTH_CLIENT_ID",
  "X_OAUTH_CLIENT_SECRET",
  "X_OAUTH_REDIRECT_URI"
]);

export const PORTAL_EMAIL_DOMAINS = Object.freeze(["emapthyai.ai", "nekocatpitalventures.com"]);

// Any X OAuth scope that could mutate the account. If one of these ever shows
// up in X_API_SCOPES the campaign refuses to run: the application is only ever
// allowed to read.
//
// This has nothing to do with X_OAUTH_CLIENT_ID/SECRET below: those exist
// for a fully separate, per-account, explicitly-connected user-context
// credential that powers auto-posting (see x-oauth.js/x-write.js). Never
// "fix" a write-posting problem by adding a write scope here -- that scope
// belongs to the shared app-only read bearer token and doing so only trips
// this exact check.
export const FORBIDDEN_X_SCOPES = Object.freeze([
  "tweet.write",
  "tweet.moderate.write",
  "users.write",
  "like.write",
  "follows.write",
  "block.write",
  "mute.write",
  "list.write",
  "bookmark.write",
  "dm.write",
  "offline.access"
]);

export class SocialConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "SocialConfigError";
    this.code = "social_not_configured";
  }
}

export function portalEmailDomain(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const domain = normalized.slice(separator + 1);
  return PORTAL_EMAIL_DOMAINS.includes(domain) ? domain : null;
}

function parseAllowedEmails(raw) {
  const problems = [];
  const emails = String(raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  for (const email of emails) {
    const domainEntry = email.startsWith("@") && PORTAL_EMAIL_DOMAINS.includes(email.slice(1));
    if (!domainEntry && !portalEmailDomain(email)) {
      problems.push(
        `SOCIAL_PORTAL_ALLOWED_EMAILS entry "${email}" is not an approved account or domain (${PORTAL_EMAIL_DOMAINS.join(", ")}).`
      );
    }
  }
  return { emails, problems };
}

function parseScopes(raw) {
  return String(raw ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function loadSocialConfig(env = process.env) {
  const missing = REQUIRED_SOCIAL_ENV.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  const { emails: allowedEmails, problems } = parseAllowedEmails(env.SOCIAL_PORTAL_ALLOWED_EMAILS);
  if (!missing.includes("SOCIAL_PORTAL_ALLOWED_EMAILS") && allowedEmails.length === 0) {
    problems.push("SOCIAL_PORTAL_ALLOWED_EMAILS must list at least one operator.");
  }

  const scopes = parseScopes(env.X_API_SCOPES);
  const forbidden = scopes.filter((scope) => FORBIDDEN_X_SCOPES.includes(scope));
  for (const scope of forbidden) {
    problems.push(`X_API_SCOPES contains write scope "${scope}"; this application is read-only.`);
  }

  return {
    configured: missing.length === 0 && problems.length === 0,
    missing,
    problems,
    campaignId: env.SOCIAL_CAMPAIGN_ID ?? "creator_rewrites",
    x: {
      bearerToken: env.X_READ_BEARER_TOKEN ?? null,
      accountUserId: env.X_ACCOUNT_USER_ID ?? null,
      scopes
    },
    portal: {
      googleClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? null,
      allowedEmails,
      sessionTtlMs: 8 * 60 * 60 * 1000
    },
    // Optional: absence just means auto-posting isn't available yet, it
    // doesn't affect `configured` for the rest of the (read-only) campaign.
    xOAuth: {
      clientId: env.X_OAUTH_CLIENT_ID ?? null,
      clientSecret: env.X_OAUTH_CLIENT_SECRET ?? null,
      redirectUri: env.X_OAUTH_REDIRECT_URI ?? null
    },
    posthog: {
      projectToken: env.POSTHOG_PROJECT_TOKEN ?? null,
      host: env.POSTHOG_HOST ?? "https://us.i.posthog.com"
    },
    slack: {
      webhookUrl: env.SLACK_WEBHOOK_URL ?? null
    }
  };
}

export function describeMissingPrerequisites(config) {
  return [
    ...config.missing.map((key) => `${key} is not set.`),
    ...config.problems,
    ...(config.posthog.projectToken ? [] : ["POSTHOG_PROJECT_TOKEN is not set; analytics events queue in the outbox."]),
    ...(config.slack.webhookUrl ? [] : ["SLACK_WEBHOOK_URL is not set; Slack notifications queue in the outbox."])
  ];
}
