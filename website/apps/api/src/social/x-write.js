import { decryptJson, encryptJson } from "../crypto.js";
import { refreshAccessToken } from "./x-oauth.js";

const X_API_ORIGIN = "https://api.x.com";
const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// Deliberately a separate file from x-read-only.js: that client's guard and
// its dedicated test assert there is no write-capable method anywhere in it.
// This is the one, explicit exception, gated behind its own credential --
// the shared X_READ_BEARER_TOKEN (app-only) is architecturally incapable of
// posting as a user, so this can never be reached with that token by mistake.

export class XReconnectRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "XReconnectRequiredError";
    this.code = "x_reconnect_required";
  }
}

export class XWriteError extends Error {
  constructor(code, message, { resetAt = null, ambiguous = false } = {}) {
    super(message);
    this.name = "XWriteError";
    this.code = code;
    this.resetAt = resetAt;
    // True for a timeout/5xx/network failure: X's response never arrived, so
    // whether the tweet was actually created is unknown. Callers must never
    // auto-retry an ambiguous failure -- that risks posting the reply twice.
    this.ambiguous = ambiguous;
  }
}

// Returns a live access token, decrypting the cached one if it's not near
// expiry, or refreshing (and atomically persisting the rotated pair) if it
// is. Throws XReconnectRequiredError if the refresh token was revoked --
// there is no way to recover from that except the operator reconnecting.
export async function getValidAccessToken(
  credentialRow,
  { clientId, clientSecret, encryptionKey, store, fetchImpl = fetch, now = () => new Date(), safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS }
) {
  const expiresAt = new Date(credentialRow.access_token_expires_at).getTime();
  if (expiresAt - now().getTime() > safetyMarginMs) {
    return decryptJson(encryptionKey, {
      ciphertext: credentialRow.access_token_ciphertext,
      iv: credentialRow.access_token_iv,
      tag: credentialRow.access_token_tag
    });
  }

  const refreshToken = decryptJson(encryptionKey, {
    ciphertext: credentialRow.refresh_token_ciphertext,
    iv: credentialRow.refresh_token_iv,
    tag: credentialRow.refresh_token_tag
  });

  let refreshed;
  try {
    refreshed = await refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl });
  } catch (error) {
    await store.recordXWriteCredentialError(credentialRow.id, error.message);
    if (error.code === "invalid_grant") {
      throw new XReconnectRequiredError("The connected X account revoked access. Reconnect it in the portal.");
    }
    throw error;
  }

  await store.updateXWriteCredentialTokens(credentialRow.id, {
    accessToken: encryptJson(encryptionKey, refreshed.accessToken),
    accessTokenExpiresAt: new Date(now().getTime() + refreshed.expiresIn * 1000),
    refreshToken: encryptJson(encryptionKey, refreshed.refreshToken)
  });

  return refreshed.accessToken;
}

export function createWriteXClient({ getAccessToken, fetchImpl = fetch }) {
  return {
    async postReply({ text, inReplyToTweetId }) {
      const accessToken = await getAccessToken();
      let response;
      try {
        response = await fetchImpl(`${X_API_ORIGIN}/2/tweets`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyToTweetId } })
        });
      } catch (error) {
        // fetch itself threw (network error, timeout) -- X's response never
        // arrived, so whether the tweet posted is genuinely unknown.
        throw new XWriteError("post_ambiguous_network", error.message, { ambiguous: true });
      }

      if (response.status === 401) throw new XReconnectRequiredError("X rejected the access token. Reconnect the account in the portal.");
      if (response.status === 429) {
        const reset = response.headers?.get?.("x-rate-limit-reset");
        throw new XWriteError("x_rate_limited", "X rate limit reached on the write endpoint.", {
          resetAt: reset ? new Date(Number(reset) * 1000) : null
        });
      }
      if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        const isDuplicate = JSON.stringify(body).toLowerCase().includes("duplicate");
        throw new XWriteError(isDuplicate ? "duplicate_content" : "x_write_forbidden", body.detail ?? "X refused to post this reply.");
      }
      if (response.status >= 500) {
        throw new XWriteError("post_ambiguous_server_error", `X returned ${response.status}.`, { ambiguous: true });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new XWriteError("x_write_failed", body.detail ?? `X returned ${response.status}.`);
      }

      const body = await response.json();
      return { id: body.data.id, text: body.data.text };
    }
  };
}
