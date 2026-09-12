import { parseReplyUrl } from "./composer.js";

export const VERIFICATION_FAILURES = Object.freeze([
  "reply_url_invalid",
  "reply_not_found",
  "reply_not_owned",
  "reply_not_to_source",
  "reply_already_recorded"
]);

function failure(reason) {
  return { verified: false, reason };
}

// A reply only counts once a read-only X lookup proves it exists, belongs to
// the EmapthyAi account, and actually replies to the source post. Operator
// assertion alone is never enough.
export async function verifyPostedReply({ xClient, replyUrl, sourceXPostId, accountUserId, findExisting = async () => null }) {
  const replyPostId = parseReplyUrl(replyUrl);
  if (!replyPostId) return failure("reply_url_invalid");

  const existing = await findExisting(replyPostId);
  if (existing) return failure("reply_already_recorded");

  let body;
  try {
    body = await xClient.getPost(replyPostId);
  } catch (error) {
    // A missing reply means the human has not posted it yet. Anything else
    // (rate limit, outage) is a real error the operator must see, not a
    // silent "not verified".
    if (error.status === 404) return failure("reply_not_found");
    throw error;
  }
  const post = body?.data;
  if (!post || post.id !== replyPostId) return failure("reply_not_found");
  if (String(post.author_id) !== String(accountUserId)) return failure("reply_not_owned");

  const repliedTo = (post.referenced_tweets ?? []).find((item) => item.type === "replied_to");
  if (!repliedTo || String(repliedTo.id) !== String(sourceXPostId)) return failure("reply_not_to_source");

  return {
    verified: true,
    reason: null,
    replyPostId,
    replyUrl: `https://x.com/i/status/${replyPostId}`,
    postedAt: post.created_at ? new Date(post.created_at) : new Date(),
    text: typeof post.text === "string" ? post.text : null
  };
}

export function isProtocolDeviation(expectedReplyText, actualText) {
  if (typeof actualText !== "string") return false;
  return actualText.trim() !== expectedReplyText.trim();
}
