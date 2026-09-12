import { createPublicKey, verify as verifySignature } from "node:crypto";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const jwksCache = new Map();

export class AccountAuthError extends Error {
  constructor(message = "Account authentication failed.") {
    super(message);
    this.name = "AccountAuthError";
  }
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function configured(env) {
  return [env.ACCOUNT_OIDC_ISSUER, env.ACCOUNT_OIDC_AUDIENCE, env.ACCOUNT_OIDC_JWKS_URL]
    .every((value) => typeof value === "string" && value.trim().length > 0);
}

async function jwkFor({ issuer, jwksURL, kid, fetchImpl }) {
  const cacheKey = `${issuer}|${jwksURL}`;
  const cached = jwksCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    const response = await fetchImpl(jwksURL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new AccountAuthError();
    const body = await response.json();
    if (!Array.isArray(body?.keys)) throw new AccountAuthError();
    jwksCache.set(cacheKey, { keys: body.keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  }
  const key = jwksCache.get(cacheKey).keys.find((item) => item?.kid === kid && item.kty === "RSA");
  if (!key) throw new AccountAuthError();
  return key;
}

export async function verifyAccountToken(request, env = process.env, fetchImpl = fetch) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!configured(env)) {
    if (authorization) throw new AccountAuthError();
    return null;
  }
  if (!authorization.startsWith("Bearer ")) throw new AccountAuthError();
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new AccountAuthError();
  try {
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AccountAuthError();
    if (claims.iss !== env.ACCOUNT_OIDC_ISSUER || claims.aud !== env.ACCOUNT_OIDC_AUDIENCE) throw new AccountAuthError();
    if (typeof claims.sub !== "string" || !ACCOUNT_ID.test(claims.sub)) throw new AccountAuthError();
    if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new AccountAuthError();
    const jwk = await jwkFor({ issuer: env.ACCOUNT_OIDC_ISSUER, jwksURL: env.ACCOUNT_OIDC_JWKS_URL, kid: header.kid, fetchImpl });
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(parts[2], "base64url")
    );
    if (!valid) throw new AccountAuthError();
    return { accountId: claims.sub };
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError();
  }
}
