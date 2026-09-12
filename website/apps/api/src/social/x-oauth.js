import { createHash, randomBytes } from "node:crypto";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

export class XOAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "XOAuthError";
    this.code = code;
  }
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier() {
  return base64Url(randomBytes(32));
}

export function codeChallengeFromVerifier(verifier) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function generateState() {
  return base64Url(randomBytes(16));
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge, scopes }) {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function requestToken(body, { clientId, clientSecret, fetchImpl }) {
  const params = new URLSearchParams({ ...body, client_id: clientId });
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  // A confidential client authenticates with Basic auth; a public client (no
  // secret) relies on PKCE alone and sends only client_id in the body.
  if (clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  const response = await fetchImpl(X_TOKEN_URL, { method: "POST", headers, body: params.toString() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new XOAuthError(payload.error ?? "token_request_failed", payload.error_description ?? `X token endpoint returned ${response.status}.`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope
  };
}

export async function exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  return requestToken(
    { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier },
    { clientId, clientSecret, fetchImpl }
  );
}

// X rotates the refresh token on every use -- the caller MUST persist the
// returned refreshToken, even though only a new access token was asked for.
// The old refresh token is invalid the instant this call succeeds.
export async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken }, { clientId, clientSecret, fetchImpl });
}
