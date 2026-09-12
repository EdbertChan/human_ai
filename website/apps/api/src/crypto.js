import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;

export function parseEncryptionKey(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("EMPATHY_RUN_ENCRYPTION_KEY is required.");
  }
  const trimmed = value.trim();
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }
  if (key.length !== 32) {
    throw new Error("EMPATHY_RUN_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return key;
}

export function encryptJson(key, value) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
}

export function decryptJson(key, { ciphertext, iv, tag }) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
