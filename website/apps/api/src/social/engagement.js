import { creatorBucket } from "./identity.js";
import { enqueuePostHogEvent } from "./outbox.js";
import { recordXReads } from "./scanner.js";
import { XRequestError } from "./x-read-only.js";

export const METRIC_BUCKET_HOURS = Object.freeze([1, 6, 24, 72, 168]);

export const LOW_SAMPLE_THRESHOLD = 30;

function bucketFor(hoursSincePost) {
  let chosen = null;
  for (const bucket of METRIC_BUCKET_HOURS) {
    if (hoursSincePost >= bucket) chosen = bucket;
  }
  return chosen;
}

export async function syncEngagement({
  store,
  config,
  settings,
  xClient,
  encryptionKey,
  limit = 10,
  now = new Date(),
  log = console.error
}) {
  const result = { checked: 0, captured: 0, reads: 0, errors: 0 };
  const posted = await store.listCandidatesByState(["posted"], 200);

  for (const candidate of posted) {
    if (result.captured >= limit) break;
    if (!candidate.reply_x_post_id || !candidate.posted_at) continue;

    const hoursSincePost = (now.getTime() - new Date(candidate.posted_at).getTime()) / (60 * 60 * 1000);
    const bucket = bucketFor(hoursSincePost);
    if (bucket === null) continue;

    const existing = await store.listMetricsSnapshots(candidate.id);
    if (existing.some((row) => row.bucket_hours === bucket)) continue;

    result.checked += 1;
    let body;
    try {
      body = await xClient.getPostMetrics(candidate.reply_x_post_id);
      result.reads += 1;
    } catch (error) {
      result.errors += 1;
      log("[social-engagement] metric read failed", {
        candidateId: candidate.id,
        code: error instanceof XRequestError ? error.code : "unknown",
        message: error.message
      });
      continue;
    }

    const metrics = body?.data?.public_metrics ?? {};
    const snapshot = {
      candidateId: candidate.id,
      bucketHours: bucket,
      impressions: metrics.impression_count ?? null,
      likes: metrics.like_count ?? null,
      replies: metrics.reply_count ?? null,
      reposts: metrics.retweet_count ?? null,
      quotes: metrics.quote_count ?? null
    };
    const { created } = await store.insertMetricsSnapshot(snapshot);
    if (!created) continue;
    result.captured += 1;

    await enqueuePostHogEvent(store, {
      name: "social reply engagement synced",
      distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
      idempotencyKey: `engagement:${candidate.id}:${bucket}`,
      properties: {
        campaign: config.campaignId,
        template_variant: candidate.template_variant,
        creator_bucket: creatorBucket(candidate.x_user_id, encryptionKey),
        impressions: snapshot.impressions,
        likes: snapshot.likes,
        replies: snapshot.replies,
        reposts: snapshot.reposts,
        quotes: snapshot.quotes,
        hours_since_post: bucket
      }
    });
  }

  if (result.reads > 0) {
    await recordXReads({ store, config, settings, reads: result.reads, now });
  }
  return result;
}

function emptyArm() {
  return {
    posted: 0,
    rejected: 0,
    queued: 0,
    objections: 0,
    deletions: 0,
    protocolDeviations: 0,
    impressions: 0,
    likes: 0,
    replies: 0,
    reposts: 0,
    quotes: 0
  };
}

export function summarizeExperiment({ candidates, snapshotsByCandidate, objectionsByVariant = {} }) {
  const arms = { A: emptyArm(), B: emptyArm() };

  for (const candidate of candidates) {
    const arm = arms[candidate.template_variant];
    if (!arm) continue;
    if (candidate.state === "posted") arm.posted += 1;
    if (candidate.state === "rejected") arm.rejected += 1;
    if (candidate.state === "queued" || candidate.state === "composer_opened") arm.queued += 1;
    if (candidate.state === "deleted" || candidate.state === "deletion_required") arm.deletions += 1;
    if (candidate.protocol_deviation) arm.protocolDeviations += 1;

    const snapshots = snapshotsByCandidate[candidate.id] ?? [];
    const latest = snapshots.slice().sort((left, right) => right.bucket_hours - left.bucket_hours)[0];
    if (!latest) continue;
    arm.impressions += latest.impressions ?? 0;
    arm.likes += latest.likes ?? 0;
    arm.replies += latest.replies ?? 0;
    arm.reposts += latest.reposts ?? 0;
    arm.quotes += latest.quotes ?? 0;
  }

  for (const [variant, count] of Object.entries(objectionsByVariant)) {
    if (arms[variant]) arms[variant].objections = count;
  }

  const withRates = Object.fromEntries(
    Object.entries(arms).map(([variant, arm]) => [
      variant,
      {
        ...arm,
        positiveEngagement: arm.likes + arm.replies + arm.reposts + arm.quotes,
        positiveEngagementRate: arm.impressions > 0
          ? Number(((arm.likes + arm.replies + arm.reposts + arm.quotes) / arm.impressions).toFixed(6))
          : null,
        rejectionRate: arm.posted + arm.rejected > 0
          ? Number((arm.rejected / (arm.posted + arm.rejected)).toFixed(4))
          : null
      }
    ])
  );

  const lowSample = Object.values(withRates).some((arm) => arm.posted < LOW_SAMPLE_THRESHOLD);
  return {
    arms: withRates,
    lowSample,
    // Never let the portal imply a winner: the plan requires that low sample
    // sizes are reported and no template is declared to have won early.
    winner: null,
    warnings: lowSample
      ? [`Fewer than ${LOW_SAMPLE_THRESHOLD} verified replies in at least one arm. Do not declare a winner.`]
      : []
  };
}

// Replies carry no link, so installs can only ever be attributed to the
// campaign as a whole. This is the one tracked entry point.
export function campaignProfileLink({ baseUrl = "http://127.0.0.1:8787", campaignId = "creator_rewrites" } = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "organic_profile");
  url.searchParams.set("utm_campaign", campaignId);
  return url.toString();
}

export const CONVERSION_FUNNEL = Object.freeze([
  { step: 1, event: "$pageview", description: "EmapthyAi site visit from the tracked X profile link." },
  { step: 2, event: "install command copied", description: "Install command copied or Chrome Store clicked." },
  { step: 3, event: "desktop installed", description: "Desktop or extension install completed." },
  { step: 4, event: "first rewrite accepted", description: "User accepted their first EmapthyAi rewrite." }
]);
