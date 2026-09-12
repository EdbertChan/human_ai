const COMPOSER_ORIGIN = "https://x.com";
const REPLY_URL_PATTERN = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})(?:[/?#].*)?$/;

export const COMPOSER_BLOCK_REASONS = Object.freeze([
  "campaign_disabled",
  "candidate_not_open",
  "candidate_expired",
  "source_too_old",
  "daily_cap_reached",
  "creator_blocked",
  "creator_cooldown",
  "text_purged"
]);

// This builds a link a person opens; X renders the composer and the person
// presses Post -- this function itself never submits anything. The only
// code path that actually posts to X lives in x-write.js, gated behind its
// own explicitly-connected write credential; this manual link is still used
// as a fallback and as the recovery tool for an ambiguous auto-post failure.
export function buildComposerUrl({ sourceXPostId, replyText }) {
  if (!/^\d{1,25}$/.test(String(sourceXPostId))) throw new Error("sourceXPostId must be an X post ID.");
  if (typeof replyText !== "string" || replyText.trim().length === 0) throw new Error("replyText is required.");
  const url = new URL("/intent/post", COMPOSER_ORIGIN);
  url.searchParams.set("in_reply_to", String(sourceXPostId));
  url.searchParams.set("text", replyText);
  return url.toString();
}

export function parseReplyUrl(value) {
  if (typeof value !== "string") return null;
  const match = REPLY_URL_PATTERN.exec(value.trim());
  return match ? match[1] : null;
}

export function composerGate({ candidate, sourcePost, creator, settings, postedToday, now = new Date() }) {
  if (!settings.enabled) return { allowed: false, reason: "campaign_disabled" };
  if (!["queued", "composer_opened"].includes(candidate.state)) return { allowed: false, reason: "candidate_not_open" };
  if (candidate.text_purged_at || !candidate.reply_ciphertext) return { allowed: false, reason: "text_purged" };
  if (new Date(candidate.expires_at).getTime() <= now.getTime()) return { allowed: false, reason: "candidate_expired" };

  const ageMs = now.getTime() - new Date(sourcePost.posted_at).getTime();
  if (ageMs > settings.maxSourceAgeHours * 60 * 60 * 1000) return { allowed: false, reason: "source_too_old" };

  if (postedToday >= settings.dailyPostedCap) return { allowed: false, reason: "daily_cap_reached" };
  if (!creator || creator.status === "blocked") return { allowed: false, reason: "creator_blocked" };

  if (creator.last_posted_at) {
    const cooldownMs = settings.creatorCooldownDays * 24 * 60 * 60 * 1000;
    if (now.getTime() - new Date(creator.last_posted_at).getTime() < cooldownMs) {
      return { allowed: false, reason: "creator_cooldown" };
    }
  }

  return { allowed: true, reason: null };
}
