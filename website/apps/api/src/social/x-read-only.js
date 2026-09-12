const X_API_ORIGIN = "https://api.x.com";

// The only X resources this application may ever touch. Everything here is a
// GET; there is deliberately no entry that creates, edits, or deletes anything
// on X. createReadOnlyXClient rejects any other path or method, so a future
// caller cannot reach a write endpoint even by mistake.
export const READ_ONLY_X_ROUTES = Object.freeze([
  /^\/2\/users\/\d+\/tweets$/,
  /^\/2\/tweets\/\d+$/,
  /^\/2\/tweets$/,
  /^\/2\/users\/by\/username\/[A-Za-z0-9_]{1,15}$/
]);

export class XReadOnlyViolationError extends Error {
  constructor(message) {
    super(message);
    this.name = "XReadOnlyViolationError";
    this.code = "x_read_only_violation";
  }
}

export class XRequestError extends Error {
  constructor(status, message, { resetAt = null } = {}) {
    super(message);
    this.name = "XRequestError";
    this.code = status === 429 ? "x_rate_limited" : "x_request_failed";
    this.status = status;
    this.resetAt = resetAt;
  }
}

export class XBudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "XBudgetExceededError";
    this.code = "x_budget_exceeded";
  }
}

function assertReadOnly(path, method) {
  if (method !== "GET") {
    throw new XReadOnlyViolationError(`Only GET is allowed on X; refused ${method}.`);
  }
  if (!READ_ONLY_X_ROUTES.some((route) => route.test(path))) {
    throw new XReadOnlyViolationError(`Path ${path} is not a permitted read-only X route.`);
  }
}

export function createReadOnlyXClient({ bearerToken, fetchImpl = fetch, onReads = () => {} }) {
  if (!bearerToken) throw new XReadOnlyViolationError("X_READ_BEARER_TOKEN is required.");

  async function get(path, searchParams = {}) {
    assertReadOnly(path, "GET");
    const url = new URL(path, X_API_ORIGIN);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${bearerToken}` }
    });
    if (response.status === 429) {
      const reset = response.headers?.get?.("x-rate-limit-reset");
      throw new XRequestError(429, "X rate limit reached.", {
        resetAt: reset ? new Date(Number(reset) * 1000) : null
      });
    }
    if (!response.ok) {
      throw new XRequestError(response.status, `X read failed (${response.status}).`);
    }
    const body = await response.json();
    const returned = Array.isArray(body?.data) ? body.data.length : body?.data ? 1 : 0;
    await onReads(returned);
    return body;
  }

  return {
    // Exposed so callers cannot smuggle a method through; every helper below
    // funnels into the same read-only guard.
    async request(path, { method = "GET", searchParams } = {}) {
      assertReadOnly(path, method);
      return get(path, searchParams);
    },

    async listUserPosts(xUserId, { sinceId, maxResults = 10, startTime } = {}) {
      return get(`/2/users/${xUserId}/tweets`, {
        max_results: Math.max(5, Math.min(100, maxResults)),
        since_id: sinceId,
        start_time: startTime,
        exclude: "replies,retweets",
        "tweet.fields": "id,text,created_at,lang,author_id,referenced_tweets,attachments,entities,reply_settings,possibly_sensitive"
      });
    },

    async getUserByUsername(username) {
      return get(`/2/users/by/username/${username}`, {});
    },

    async getPost(xPostId) {
      return get(`/2/tweets/${xPostId}`, {
        "tweet.fields": "id,text,created_at,lang,author_id,referenced_tweets,public_metrics,reply_settings"
      });
    },

    async getPostMetrics(xPostId) {
      return get(`/2/tweets/${xPostId}`, { "tweet.fields": "id,author_id,created_at,public_metrics" });
    }
  };
}

export function estimateSpendMicros(reads, costUsdPerRead) {
  return Math.round(reads * costUsdPerRead * 1_000_000);
}

export function budgetStatus({ estimatedMicros, monthlyBudgetUsd }) {
  const budgetMicros = Math.round(monthlyBudgetUsd * 1_000_000);
  const percent = budgetMicros === 0 ? 100 : Math.floor((estimatedMicros / budgetMicros) * 100);
  return {
    percent,
    exhausted: estimatedMicros >= budgetMicros,
    crossedThresholds: [50, 80, 100].filter((threshold) => percent >= threshold)
  };
}
