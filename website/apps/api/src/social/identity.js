import { createHash, createHmac } from "node:crypto";

const PACIFIC_TIMEZONE = "America/Los_Angeles";

const pacificParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

export function stableHash(value, salt = "") {
  return createHash("sha256").update(`${salt}:${String(value)}`).digest("hex");
}

// PostHog and Slack must never receive an X user ID or handle, so every
// analytics dimension uses this one-way bucket instead. X user IDs are short
// numeric strings, so a public salt would let anyone rebuild the bucket table
// by enumeration — the secret (the server encryption key) is mandatory.
export function creatorBucket(xUserId, secret) {
  if (!secret) throw new Error("creatorBucket requires the server secret.");
  return createHmac("sha256", secret).update(`emapthyai-social:${String(xUserId)}`).digest("hex").slice(0, 12);
}

export function assignTemplateVariant(xUserId, weights = { A: 50, B: 50 }, salt = "emapthyai-template") {
  const total = weights.A + weights.B;
  if (total <= 0) return "A";
  const bucket = Number.parseInt(stableHash(xUserId, salt).slice(0, 8), 16) % total;
  return bucket < weights.A ? "A" : "B";
}

function pacificFields(date) {
  const fields = {};
  for (const part of pacificParts.formatToParts(date)) {
    if (part.type !== "literal") fields[part.type] = part.value;
  }
  return fields;
}

export function pacificDateKey(date) {
  const { year, month, day } = pacificFields(date);
  return `${year}-${month}-${day}`;
}

export function pacificHour(date) {
  return Number(pacificFields(date).hour);
}

export function withinPostingWindow(date, postingWindow) {
  const hour = pacificHour(date);
  return hour >= postingWindow.startHour && hour < postingWindow.endHour;
}

export function utcMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

const URL_PATTERN = /https?:\/\/\S+/g;
const X_TRANSFORMED_URL_LENGTH = 23;

// X's weighted character count: characters in these ranges cost 1, everything
// else (CJK, kana, emoji) costs 2, and every URL is normalised to 23
// regardless of its real length. Getting this wrong would let an over-long
// reply reach a human, so the ranges mirror twitter-text's published v3
// config exactly.
const SINGLE_WEIGHT_RANGES = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247]
];

function isSingleWeight(codePoint) {
  return SINGLE_WEIGHT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function weightedLength(text) {
  if (typeof text !== "string") return Number.POSITIVE_INFINITY;
  let total = 0;
  let remainder = text;
  const urls = text.match(URL_PATTERN) ?? [];
  for (const url of urls) {
    total += X_TRANSFORMED_URL_LENGTH;
    remainder = remainder.replace(url, "");
  }
  for (const character of remainder) {
    total += isSingleWeight(character.codePointAt(0)) ? 1 : 2;
  }
  return total;
}
