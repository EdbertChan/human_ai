import { loadCampaignSettings } from "./campaign.js";
import { TEXT_RETENTION_DAYS } from "./settings.js";
import { withinPostingWindow } from "./identity.js";
import { deliverOutbox } from "./outbox.js";
import { expireStaleCandidates, processScreeningJobs } from "./pipeline.js";
import { scanCreators } from "./scanner.js";
import { syncEngagement } from "./engagement.js";

export const ABANDONED_JOB_MS = 5 * 60 * 1000;

export async function runSocialCron({
  store,
  config,
  encryptionKey,
  createXClient = null,
  classify = null,
  rewrite = null,
  fetchImpl = fetch,
  now = new Date(),
  log = console.error
}) {
  const { settings } = await loadCampaignSettings(store);
  const result = {
    campaignEnabled: settings.enabled,
    configured: config.configured,
    withinWindow: withinPostingWindow(now, settings.postingWindow),
    recoveredJobs: 0,
    expiredCandidates: 0,
    purgedTextRows: 0,
    outbox: null,
    scan: null,
    screening: null,
    engagement: null,
    skippedReason: null
  };

  // Maintenance always runs: it touches no external account and keeps the
  // durable state honest even while the campaign is switched off.
  result.recoveredJobs = await store.recoverAbandonedJobs({ olderThanMs: ABANDONED_JOB_MS, now });
  result.expiredCandidates = await expireStaleCandidates({ store, config, encryptionKey, now });
  result.purgedTextRows = await store.purgeExpiredText(
    new Date(now.getTime() - TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  );
  result.outbox = await deliverOutbox({ store, config, fetchImpl, log });

  if (!settings.enabled) {
    result.skippedReason = "campaign_disabled";
    return result;
  }
  if (!config.configured) {
    result.skippedReason = "social_not_configured";
    return result;
  }
  if (!result.withinWindow) {
    result.skippedReason = "outside_posting_window";
    return result;
  }
  if (!createXClient || !classify || !rewrite) {
    result.skippedReason = "dependencies_unavailable";
    return result;
  }

  const xClient = createXClient();
  result.scan = await scanCreators({ store, config, settings, xClient, encryptionKey, now, log });
  result.screening = await processScreeningJobs({ store, config, settings, encryptionKey, classify, rewrite, now, log });
  result.engagement = await syncEngagement({ store, config, settings, xClient, encryptionKey, now, log });
  const secondPass = await deliverOutbox({ store, config, fetchImpl, log });
  result.outbox = {
    attempted: result.outbox.attempted + secondPass.attempted,
    delivered: result.outbox.delivered + secondPass.delivered,
    retried: result.outbox.retried + secondPass.retried,
    waitingDestinations: secondPass.waitingDestinations
  };
  return result;
}
