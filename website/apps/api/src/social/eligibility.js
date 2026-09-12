import { CANONICAL_CATEGORIES, EXCLUDED_TOPICS, X_MAX_WEIGHTED_LENGTH, renderTemplate } from "./settings.js";
import { weightedLength } from "./identity.js";

export const RISK_CLASSES = Object.freeze(["safe", "uncertain", "unsafe"]);

export const SKIP_REASONS = Object.freeze([
  "creator_not_allowlisted",
  "creator_blocked",
  "creator_cooldown",
  "not_english",
  "language_uncertain",
  "too_old",
  "not_original_post",
  "needs_external_context",
  "reply_restricted",
  "possibly_sensitive",
  "excluded_topic",
  "risk_uncertain",
  "risk_unsafe",
  "category_disabled",
  "classifier_invalid",
  "rewrite_unavailable",
  "rewrite_unchanged",
  "rewrite_empty",
  "rewrite_changed_facts",
  "reply_too_long",
  "source_unavailable",
  "campaign_disabled",
  "daily_cap_reached"
]);

export class ScreeningError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScreeningError";
    this.code = "screening_failed";
  }
}

function skip(reason, detail = null) {
  return { eligible: false, reason, detail };
}

const ELIGIBLE = Object.freeze({ eligible: true, reason: null, detail: null });

// A quote-tweet's own added commentary is real, original text from the
// creator — unlike a reply or a plain retweet, there's nothing to fetch or
// substitute. X always appends a t.co link to the quoted tweet inside
// entities.urls; that's the quote mechanism itself, not the creator linking
// out to external context, so it must not trip needs_external_context on
// its own. Any *other* URL alongside it still does.
function nonQuoteUrls(post, quotedTweetId) {
  const urls = Array.isArray(post.entities?.urls) ? post.entities.urls : [];
  if (!quotedTweetId) return urls;
  const quotedLinkPattern = new RegExp(`/status/${quotedTweetId}(?:[/?]|$)`);
  return urls.filter((url) => !quotedLinkPattern.test(url.expanded_url ?? url.url ?? ""));
}

export function screenSourcePost({ post, settings, creator, now = new Date() }) {
  if (!creator) return skip("creator_not_allowlisted");
  if (creator.status === "blocked") return skip("creator_blocked");

  if (creator.last_posted_at) {
    const cooldownMs = settings.creatorCooldownDays * 24 * 60 * 60 * 1000;
    if (now.getTime() - new Date(creator.last_posted_at).getTime() < cooldownMs) {
      return skip("creator_cooldown");
    }
  }

  if (post.lang !== settings.requiredLanguage) return skip("not_english");

  const ageMs = now.getTime() - new Date(post.created_at).getTime();
  if (ageMs >= settings.maxSourceAgeHours * 60 * 60 * 1000) return skip("too_old");
  if (ageMs < 0) return skip("source_unavailable");

  const referencedTweets = Array.isArray(post.referenced_tweets) ? post.referenced_tweets : [];
  const nonQuoteReference = referencedTweets.find((ref) => ref?.type !== "quoted");
  if (nonQuoteReference) return skip("not_original_post");
  const quotedRef = referencedTweets.find((ref) => ref?.type === "quoted");

  if (post.attachments && Object.keys(post.attachments).length > 0) return skip("needs_external_context");
  if (nonQuoteUrls(post, quotedRef?.id).length > 0) return skip("needs_external_context");
  if (post.reply_settings && post.reply_settings !== "everyone") return skip("reply_restricted");
  if (post.possibly_sensitive === true) return skip("possibly_sensitive");
  if (typeof post.text !== "string" || post.text.trim().length === 0) return skip("source_unavailable");

  return ELIGIBLE;
}

// The EmapthyAi rewrite API returns free-form category labels, so the queue
// cannot gate on them. This validates a separate structured classification
// against fixed enums and refuses anything it does not recognise.
//
// Content-based rejection (language confidence, risk class, excluded topics,
// disabled categories) was removed at explicit operator request -- the
// classifier no longer blocks anything based on what it judged the content to
// be, only on whether its response was structurally usable at all. settings.
// minLanguageConfidence/excludedTopics/enabledCategories are unused here now;
// re-add the checks below (still present in git history) to restore gating.
export function validateClassification(value, _settings) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return skip("classifier_invalid");
  if (!CANONICAL_CATEGORIES.includes(value.category)) return skip("classifier_invalid");
  if (!RISK_CLASSES.includes(value.riskClass)) return skip("classifier_invalid");
  if (typeof value.languageConfidence !== "number" || Number.isNaN(value.languageConfidence)) {
    return skip("classifier_invalid");
  }
  if (!Array.isArray(value.excludedTopics) || value.excludedTopics.some((topic) => !EXCLUDED_TOPICS.includes(topic))) {
    return skip("classifier_invalid");
  }

  return ELIGIBLE;
}

const NUMBER_PATTERN = /\d[\d,.:%/-]*/g;
const MENTION_PATTERN = /@[A-Za-z0-9_]{1,15}/g;
const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
const URL_PATTERN = /https?:\/\/\S+/g;
const QUOTE_PATTERN = /["“”']([^"“”']{2,})["“”']/g;
// "may" and lowercase "mon"/"sat"/"sun" are ordinary English words, so only
// whole day/month words match case-insensitively and the ambiguous
// abbreviations must be capitalized to count as dates.
const MONTHS = "january|february|march|april|june|july|august|september|october|november|december";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DATE_PATTERN = new RegExp(`\\b(${MONTHS}|${DAYS})\\b`, "gi");
const CAPITALIZED_DATE_PATTERN = /\b(May|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/g;

const COMMON_CAPITALIZED = new Set([
  "I", "I'm", "I've", "I'd", "I'll", "The", "A", "An", "And", "But", "Or", "If", "This", "That", "These", "Those",
  "We", "You", "They", "It", "There", "When", "While", "Our", "My", "Your", "Their", "So", "As", "For", "To", "In",
  "On", "At", "Of", "Not", "No", "Yes", "Every", "Just", "Please", "Thanks", "Thank",
  "Could", "Would", "Should", "Shall", "Will", "Can", "Cannot", "Can't", "Might", "Must", "May",
  "Do", "Does", "Did", "Don't", "Is", "Are", "Was", "Were", "Be", "Being", "Been", "Has", "Have", "Had",
  "How", "What", "Why", "Where", "Who", "Whom", "Whose", "Which", "Maybe", "Perhaps", "Consider",
  "Let", "Let's", "Here", "Now", "Then", "Also", "Still", "Even", "Some", "Any", "All", "Many", "Much",
  "More", "Most", "One", "Everyone", "Someone", "Anyone", "Nobody", "Nothing", "Everything", "Something",
  "He", "She", "Him", "Her", "His", "Hers", "Its", "Them", "Us", "Me", "Sounds", "Seems", "Looking", "Instead"
]);

// Facts are compared as multisets, not sets: "5 tickets and 5 bugs" must not
// pass just because a rewrite kept one of the two fives.
function collect(text, pattern, transform = (value) => value.toLowerCase()) {
  const counts = new Map();
  for (const match of String(text).matchAll(pattern)) {
    const value = transform(match[1] ?? match[0]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function collectDates(text) {
  const counts = collect(text, DATE_PATTERN);
  for (const [value, count] of collect(text, CAPITALIZED_DATE_PATTERN)) {
    counts.set(value, (counts.get(value) ?? 0) + count);
  }
  return counts;
}

function lowercaseWords(text) {
  const words = new Set();
  for (const match of String(text).matchAll(/\b[a-z][a-z'’-]+\b/g)) {
    words.add(match[0].toLowerCase());
  }
  return words;
}

// A sentence-initial capitalized token is counted as a name unless the same
// word appears lowercased somewhere in either text — "Priya broke it" keeps
// Priya protected while "Shipping was late" / "we think shipping…" is treated
// as an ordinary word.
function properNouns(text, ordinaryWords = new Set()) {
  const found = new Set();
  for (const sentence of String(text).split(/(?<=[.!?\n])\s+/)) {
    const tokens = sentence.trim().split(/\s+/);
    tokens.forEach((raw, index) => {
      const token = raw.replace(/^[^\p{L}@#]+|[^\p{L}0-9]+$/gu, "");
      if (!/^[A-Z][A-Za-z'’-]+$/.test(token)) return;
      if (COMMON_CAPITALIZED.has(token)) return;
      if (index === 0 && ordinaryWords.has(token.toLowerCase())) return;
      found.add(token.toLowerCase());
    });
  }
  return found;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function sameCounts(left, right) {
  if (left.size !== right.size) return false;
  for (const [value, count] of left) if (right.get(value) !== count) return false;
  return true;
}

export function factsPreserved(original, rewrite) {
  const ordinaryWords = new Set([...lowercaseWords(original), ...lowercaseWords(rewrite)]);
  const checks = [
    [collect(original, NUMBER_PATTERN), collect(rewrite, NUMBER_PATTERN), "number"],
    [collect(original, MENTION_PATTERN), collect(rewrite, MENTION_PATTERN), "mention"],
    [collect(original, HASHTAG_PATTERN), collect(rewrite, HASHTAG_PATTERN), "hashtag"],
    [collect(original, URL_PATTERN), collect(rewrite, URL_PATTERN), "url"],
    [collect(original, QUOTE_PATTERN), collect(rewrite, QUOTE_PATTERN), "quote"],
    [collectDates(original), collectDates(rewrite), "date"]
  ];
  for (const [left, right, kind] of checks) {
    if (!sameCounts(left, right)) return { preserved: false, changed: kind };
  }
  if (!sameSet(properNouns(original, ordinaryWords), properNouns(rewrite, ordinaryWords))) {
    return { preserved: false, changed: "name" };
  }
  return { preserved: true, changed: null };
}

// Fact-preservation (factsPreserved) was removed from this gate at explicit
// operator request -- it was rejecting rewrites over things like an acronym
// correctly gaining its standard capitalization, not over an actual changed
// fact. What's left here isn't content judgment: rewrite_unavailable/empty
// mean there is literally no text to post, and reply_too_long is a hard X
// character limit, not a heuristic.
export function validateRewrite({ original, rewriteResult, templateVariant }) {
  if (!rewriteResult || typeof rewriteResult.replacement !== "string") return skip("rewrite_unavailable");
  const replacement = rewriteResult.replacement.trim();
  if (replacement.length === 0) return skip("rewrite_empty");
  if (replacement === original.trim()) return skip("rewrite_unchanged");

  const replyText = renderTemplate(templateVariant, replacement);
  if (weightedLength(replyText) > X_MAX_WEIGHTED_LENGTH) return skip("reply_too_long");

  return { eligible: true, reason: null, detail: null, replyText, replacement };
}
