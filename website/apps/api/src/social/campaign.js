import { DEFAULT_SETTINGS, OBJECTION_PAUSE_THRESHOLD, OBJECTION_WINDOW_HOURS, validateSettings } from "./settings.js";
import { creatorBucket } from "./identity.js";
import { enqueuePostHogEvent, enqueueSlackNotification } from "./outbox.js";

export async function loadCampaignSettings(store, { actor = "system" } = {}) {
  const active = await store.getActiveSettings();
  if (active) return { version: active.version, settings: validateSettings({ ...DEFAULT_SETTINGS, ...active.settings }) };
  const created = await store.saveSettings({
    settings: { ...DEFAULT_SETTINGS },
    changedBy: actor,
    reason: "bootstrap_default_disabled"
  });
  await store.appendAudit({
    actor,
    action: "campaign_settings_bootstrapped",
    subjectType: "campaign_settings",
    subjectId: String(created.version),
    nextValue: { ...DEFAULT_SETTINGS }
  });
  return { version: created.version, settings: { ...DEFAULT_SETTINGS } };
}

export async function pauseCampaign({
  store,
  config,
  actor,
  reason,
  recentObjectionCount = 0,
  errorSignature = null
}) {
  const { settings } = await loadCampaignSettings(store, { actor });
  if (!settings.enabled && settings.pauseReason === reason) return { paused: false, settings };

  const next = { ...settings, enabled: false, pauseReason: reason };
  const saved = await store.saveSettings({ settings: next, changedBy: actor, reason });
  await store.appendAudit({
    actor,
    action: "campaign_paused",
    subjectType: "campaign_settings",
    subjectId: String(saved.version),
    previousValue: { enabled: settings.enabled, pauseReason: settings.pauseReason },
    nextValue: { enabled: false, pauseReason: reason }
  });

  await enqueuePostHogEvent(store, {
    name: "social campaign paused",
    distinctId: config.campaignId,
    idempotencyKey: `campaign-paused:${saved.version}`,
    properties: {
      campaign: config.campaignId,
      reason,
      recent_objection_count: recentObjectionCount,
      error_signature: errorSignature
    }
  });
  await enqueueSlackNotification(store, {
    kind: "campaign_paused",
    idempotencyKey: `campaign-paused:${saved.version}`,
    fields: { reason, recent_objection_count: recentObjectionCount, error_signature: errorSignature }
  });

  return { paused: true, settings: next };
}

export async function recordCreatorObjection({
  store,
  config,
  encryptionKey,
  actor,
  candidate,
  xUserId,
  objectionClass,
  now = new Date()
}) {
  const objection = await store.recordObjection({
    candidateId: candidate?.id ?? null,
    xUserId,
    objectionClass,
    recordedBy: actor
  });

  const previousCreator = await store.getCreator(xUserId);
  await store.blockCreator({ xUserId, notes: `objection:${objectionClass}`, blockedBy: actor });
  await store.appendAudit({
    actor,
    action: "creator_objected",
    subjectType: "creator",
    subjectId: xUserId,
    previousValue: previousCreator ? { status: previousCreator.status, notes: previousCreator.notes } : null,
    nextValue: { status: "blocked", objectionClass, candidateId: candidate?.id ?? null }
  });

  if (candidate && candidate.state === "posted") {
    await store.updateCandidate(candidate.id, { state: "deletion_required", state_reason: `objection:${objectionClass}` });
    await store.appendAudit({
      actor,
      action: "candidate_deletion_required",
      subjectType: "candidate",
      subjectId: candidate.id,
      previousValue: { state: candidate.state },
      nextValue: { state: "deletion_required", reason: `objection:${objectionClass}` }
    });
    await enqueueSlackNotification(store, {
      kind: "deletion_required",
      idempotencyKey: `deletion-required:${candidate.id}`,
      fields: { candidate_id: candidate.id, reason: `objection_${objectionClass}` }
    });
  }

  const bucket = creatorBucket(xUserId, encryptionKey);
  await enqueuePostHogEvent(store, {
    name: "social creator objected",
    distinctId: bucket,
    idempotencyKey: `objection:${objection.id}`,
    properties: {
      campaign: config.campaignId,
      creator_bucket: bucket,
      objection_class: objectionClass,
      template_variant: candidate?.template_variant ?? null,
      reply_age_minutes: candidate?.posted_at
        ? Math.round((now.getTime() - new Date(candidate.posted_at).getTime()) / 60_000)
        : null
    }
  });
  await enqueueSlackNotification(store, {
    kind: "creator_objected",
    idempotencyKey: `objection-alert:${objection.id}`,
    fields: { candidate_id: candidate?.id ?? "none", objection_class: objectionClass, creator_bucket: bucket }
  });

  const since = new Date(now.getTime() - OBJECTION_WINDOW_HOURS * 60 * 60 * 1000);
  const recent = await store.countObjectionsSince(since);
  let paused = false;
  if (recent >= OBJECTION_PAUSE_THRESHOLD) {
    ({ paused } = await pauseCampaign({
      store,
      config,
      actor: "system",
      reason: "objection_threshold",
      recentObjectionCount: recent
    }));
  }

  return { objection, recentObjectionCount: recent, paused };
}
