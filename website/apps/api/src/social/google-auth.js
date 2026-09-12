import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { PORTAL_EMAIL_DOMAINS, portalEmailDomain } from "./config.js";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export class PortalAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortalAuthError";
    this.code = code;
  }
}

function base64UrlDecode(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isAllowedOperator(email, allowedEmails) {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  const domain = portalEmailDomain(normalized);
  if (!domain) return false;
  return allowedEmails.includes(normalized) || allowedEmails.includes(`@${domain}`);
}

export async function verifyGoogleIdToken({
  idToken,
  clientId,
  allowedEmails,
  fetchImpl = fetch,
  now = () => Date.now()
}) {
  if (typeof idToken !== "string" || idToken.split(".").length !== 3) {
    throw new PortalAuthError("invalid_token", "A Google ID token is required.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  const header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
  if (header.alg !== "RS256") throw new PortalAuthError("invalid_token", "Only RS256 Google tokens are accepted.");

  const response = await fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) }).catch((error) => {
    throw new PortalAuthError("jwks_unavailable", `Google JWKS fetch failed (${error.message}).`);
  });
  if (!response.ok) throw new PortalAuthError("jwks_unavailable", `Google JWKS fetch failed (${response.status}).`);
  const { keys } = await response.json();
  const jwk = (keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) throw new PortalAuthError("invalid_token", "No Google signing key matched this token.");

  const verified = createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .verify(createPublicKey({ key: jwk, format: "jwk" }), base64UrlDecode(encodedSignature));
  if (!verified) throw new PortalAuthError("invalid_token", "Google token signature did not verify.");

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new PortalAuthError("invalid_token", "Unexpected token issuer.");
  if (payload.aud !== clientId) throw new PortalAuthError("invalid_token", "Token audience does not match GOOGLE_OAUTH_CLIENT_ID.");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) {
    throw new PortalAuthError("invalid_token", "Google token has expired.");
  }
  if (payload.email_verified !== true) throw new PortalAuthError("forbidden", "Google account email is not verified.");
  if (!isAllowedOperator(payload.email, allowedEmails)) {
    throw new PortalAuthError(
      "forbidden",
      `Only allowlisted operators from ${PORTAL_EMAIL_DOMAINS.join(" or ")} may sign in.`
    );
  }

  return { email: payload.email.trim().toLowerCase(), subject: payload.sub };
}

// Sessions are signed with a key derived from the encryption key, not the
// encryption key itself: no cross-protocol reuse, and a compromise of session
// tokens says nothing about stored ciphertext.
function sessionSigningKey(key) {
  return createHmac("sha256", key).update("emapthyai-portal-session").digest();
}

export function createSessionToken({ email, key, ttlMs, now = Date.now() }) {
  const payload = base64UrlEncode(JSON.stringify({ email, exp: now + ttlMs }));
  const signature = base64UrlEncode(createHmac("sha256", sessionSigningKey(key)).update(payload).digest());
  return `${payload}.${signature}`;
}

export function readSessionToken({ token, key, allowedEmails, now = Date.now() }) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = base64UrlEncode(createHmac("sha256", sessionSigningKey(key)).update(payload).digest());
  const provided = Buffer.from(signature ?? "", "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) return null;

  let decoded;
  try {
    decoded = JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded.exp !== "number" || decoded.exp <= now) return null;
  if (!isAllowedOperator(decoded.email, allowedEmails)) return null;
  return { email: decoded.email };
}

// A distinct label from sessionSigningKey's, so a leaked/replayed OAuth-state
// cookie can never be mistaken for (or substituted as) a portal session
// cookie, even though both derive from the same encryption key.
function oauthStateSigningKey(key) {
  return createHmac("sha256", key).update("emapthyai-x-oauth-pkce").digest();
}

export function createOAuthStateToken({ state, codeVerifier, key, ttlMs, now = Date.now() }) {
  const payload = base64UrlEncode(JSON.stringify({ state, codeVerifier, exp: now + ttlMs }));
  const signature = base64UrlEncode(createHmac("sha256", oauthStateSigningKey(key)).update(payload).digest());
  return `${payload}.${signature}`;
}

export function readOAuthStateToken({ token, key, now = Date.now() }) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = base64UrlEncode(createHmac("sha256", oauthStateSigningKey(key)).update(payload).digest());
  const provided = Buffer.from(signature ?? "", "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) return null;

  let decoded;
  try {
    decoded = JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded.exp !== "number" || decoded.exp <= now) return null;
  return { state: decoded.state, codeVerifier: decoded.codeVerifier };
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(value);
    } catch {
      // A malformed cookie set by anything else on the host must not turn
      // every portal request into a 500; keep the raw value instead.
      cookies[part.slice(0, index).trim()] = value;
    }
  }
  return cookies;
}
