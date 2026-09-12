import { encryptJson } from "../crypto.js";
import { creatorBucket, utcMonthKey } from "./identity.js";
import { SOCIAL_POLICY_VERSION } from "./settings.js";
import { enqueuePostHogEvent, enqueueSlackNotification } from "./outbox.js";
import { budgetStatus, estimateSpendMicros, XRequestError } from "./x-read-only.js";
import { pauseCampaign } from "./campaign.js";

export async function recordXReads({ store, config, settings, reads, now = new Date() }) {
  const month = utcMonthKey(now);
  const micros = estimateSpendMicros(reads, settings.xReadCostUsd);
  const row = reads > 0 ? await store.addXReads({ month, reads, micros }) : await store.getXSpend(month);
  const status = budgetStatus({
    estimatedMicros: row.estimated_micros,
    monthlyBudgetUsd: settings.monthlyXBudgetUsd
  });

  const alerted = row.alerted_thresholds ?? [];
  for (const threshold of status.crossedThresholds) {
    if (alerted.includes(threshold)) continue;
    await store.markSpendAlert(month, threshold);
    await enqueueSlackNotification(store, {
      kind: "budget_threshold",
      idempotencyKey: `budget:${month}:${threshold}`,
      fields: {
        threshold_percent: threshold,
        month,
        estimated_spend_usd: Number((row.estimated_micros / 1_000_000).toFixed(4))
      }
    });
  }

  if (status.exhausted) {
    await pauseCampaign({ store, config, actor: "system", reason: "x_budget_exhausted" });
  }

  return { month, status, spend: row };
}

export async function scanCreators({
  store,
  config,
  settings,
  xClient,
  encryptionKey,
  now = new Date(),
  log = console.error
}) {
  const result = { creatorsScanned: 0, postsDiscovered: 0, reads: 0, rateLimited: 0, errors: 0, budgetPaused: false, rateLimitedUntil: null };

  const backoff = await store.getRuntimeState("x_rate_limited_until");
  if (backoff?.until && new Date(backoff.until).getTime() > now.getTime()) {
    result.rateLimitedUntil = backoff.until;
    return result;
  }

  const preflight = await recordXReads({ store, config, settings, reads: 0, now });
  if (preflight.status.exhausted) {
    result.budgetPaused = true;
    return result;
  }

  const creators = (await store.listCreators())
    .filter((creator) => creator.status === "allowed")
    .sort((left, right) => new Date(left.last_scanned_at ?? 0) - new Date(right.last_scanned_at ?? 0))
    .slice(0, settings.scanBatchSize);

  const startTime = new Date(now.getTime() - settings.maxSourceAgeHours * 60 * 60 * 1000).toISOString();

  for (const creator of creators) {
    let body;
    try {
      body = await xClient.listUserPosts(creator.x_user_id, {
        sinceId: creator.since_id ?? undefined,
        startTime: creator.since_id ? undefined : startTime,
        maxResults: 10
      });
    } catch (error) {
      result.errors += 1;
      log("[social-scanner] creator scan failed", {
        creatorBucket: creatorBucket(creator.x_user_id, encryptionKey),
        code: error.code ?? "unknown",
        message: error.message
      });
      if (error instanceof XRequestError && error.code === "x_rate_limited") {
        // Honor X's reset time across cron runs instead of hammering the
        // remaining creators in this batch and again on the next tick.
        result.rateLimited += 1;
        const until = error.resetAt instanceof Date ? error.resetAt : new Date(now.getTime() + 15 * 60 * 1000);
        result.rateLimitedUntil = until.toISOString();
        await store.setRuntimeState("x_rate_limited_until", { until: result.rateLimitedUntil });
        break;
      }
      continue;
    }

    result.creatorsScanned += 1;
    const posts = body?.data ?? [];
    result.reads += posts.length;
    let newestId = creator.since_id ?? null;

    for (const post of posts) {
      if (!newestId || BigInt(post.id) > BigInt(newestId)) newestId = post.id;

      const { id: sourcePostId, created } = await store.insertSourcePost({
        xPostId: post.id,
        xUserId: creator.x_user_id,
        postedAt: new Date(post.created_at),
        lang: post.lang ?? null,
        text: encryptJson(encryptionKey, {
          text: post.text ?? "",
          referenced_tweets: post.referenced_tweets ?? [],
          attachments: post.attachments ?? null,
          entities: post.entities ?? null,
          reply_settings: post.reply_settings ?? null,
          possibly_sensitive: post.possibly_sensitive ?? false
        })
      });
      if (!created) continue;

      result.postsDiscovered += 1;
      await store.enqueueJob({
        kind: "screen_source_post",
        dedupeKey: `screen:${sourcePostId}`,
        payload: { sourcePostId },
        runAt: now
      });
      await enqueuePostHogEvent(store, {
        name: "social post scanned",
        distinctId: creatorBucket(creator.x_user_id, encryptionKey),
        idempotencyKey: `scanned:${sourcePostId}`,
        properties: {
          campaign: config.campaignId,
          creator_bucket: creatorBucket(creator.x_user_id, encryptionKey),
          source_age_minutes: Math.round((now.getTime() - new Date(post.created_at).getTime()) / 60_000),
          policy_version: SOCIAL_POLICY_VERSION
        }
      });
    }

    await store.updateCreatorScan({ xUserId: creator.x_user_id, sinceId: newestId, lastScannedAt: now });
  }

  const spend = await recordXReads({ store, config, settings, reads: result.reads, now });
  result.budgetPaused = spend.status.exhausted;
  return result;
}
