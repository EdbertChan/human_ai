import { decryptJson, encryptJson } from "../crypto.js";
import { assignTemplateVariant, creatorBucket } from "./identity.js";
import { SOCIAL_POLICY_VERSION } from "./settings.js";
import { screenSourcePost, validateClassification, validateRewrite } from "./eligibility.js";
import { backoffFor, enqueuePostHogEvent, enqueueSlackNotification } from "./outbox.js";

export const SCREENING_JOB_KIND = "screen_source_post";

async function emitSkipped({ store, config, encryptionKey, sourcePost, reason, detail, category, riskClass }) {
  await enqueuePostHogEvent(store, {
    name: "social candidate skipped",
    distinctId: creatorBucket(sourcePost.x_user_id, encryptionKey),
    idempotencyKey: `skipped:${sourcePost.id}`,
    properties: {
      campaign: config.campaignId,
      creator_bucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
      skip_reason: detail ? `${reason}:${detail}` : reason,
      category: category ?? null,
      risk_class: riskClass ?? null,
      policy_version: SOCIAL_POLICY_VERSION
    }
  });
}

async function skipSource({ store, config, encryptionKey, sourcePost, reason, detail = null, category = null, riskClass = null, diagnostics = null }) {
  await store.updateSourcePost(sourcePost.id, {
    state: "skipped",
    skip_reason: detail ? `${reason}:${detail}` : reason,
    canonical_category: category,
    risk_class: riskClass,
    diagnostics
  });
  await store.appendAudit({
    actor: "system",
    action: "source_post_skipped",
    subjectType: "source_post",
    subjectId: sourcePost.id,
    nextValue: { reason, detail, category, riskClass }
  });
  await emitSkipped({ store, config, encryptionKey, sourcePost, reason, detail, category, riskClass });
}

export async function processScreeningJobs({
  store,
  config,
  settings,
  encryptionKey,
  classify,
  rewrite,
  limit = 5,
  now = new Date(),
  log = console.error
}) {
  const result = { processed: 0, queued: 0, skipped: 0, failed: 0 };
  const jobs = await store.claimJobs({ kinds: [SCREENING_JOB_KIND], limit, now });

  for (const job of jobs) {
    result.processed += 1;
    try {
      const sourcePost = await store.getSourcePost(job.payload.sourcePostId);
      if (!sourcePost) {
        await store.completeJob(job.id);
        continue;
      }
      if (sourcePost.state !== "discovered" && sourcePost.state !== "screening") {
        await store.completeJob(job.id);
        continue;
      }
      if (!sourcePost.text_ciphertext) {
        await skipSource({ store, config, encryptionKey, sourcePost, reason: "source_unavailable" });
        await store.completeJob(job.id);
        result.skipped += 1;
        continue;
      }

      await store.updateSourcePost(sourcePost.id, { state: "screening" });
      const decrypted = decryptJson(encryptionKey, {
        ciphertext: sourcePost.text_ciphertext,
        iv: sourcePost.text_iv,
        tag: sourcePost.text_tag
      });

      const creator = await store.getCreator(sourcePost.x_user_id);
      const screened = screenSourcePost({
        post: {
          ...decrypted,
          lang: sourcePost.lang,
          created_at: sourcePost.posted_at
        },
        settings,
        creator,
        now
      });
      if (!screened.eligible) {
        log("[social-pipeline] screening decision", {
          sourcePostId: sourcePost.id,
          creatorBucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
          stage: "screening",
          eligible: false,
          reason: screened.reason
        });
        await skipSource({
          store,
          config,
          encryptionKey,
          sourcePost,
          reason: screened.reason,
          detail: screened.detail,
          diagnostics: { screening: { eligible: false, reason: screened.reason }, classification: null, rewrite: null }
        });
        await store.completeJob(job.id);
        result.skipped += 1;
        continue;
      }

      const classification = await classify({ text: decrypted.text });
      const classified = validateClassification(classification, settings);
      if (!classified.eligible) {
        log("[social-pipeline] classification decision", {
          sourcePostId: sourcePost.id,
          creatorBucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
          stage: "classification",
          eligible: false,
          reason: classified.reason,
          languageConfidence: classification?.languageConfidence ?? null,
          riskClass: classification?.riskClass ?? null,
          category: classification?.category ?? null,
          excludedTopics: classification?.excludedTopics ?? null
        });
        await skipSource({
          store,
          config,
          encryptionKey,
          sourcePost,
          reason: classified.reason,
          detail: classified.detail,
          category: classification?.category ?? null,
          riskClass: classification?.riskClass ?? null,
          diagnostics: {
            screening: { eligible: true, reason: null },
            classification: {
              eligible: false,
              reason: classified.reason,
              category: classification?.category ?? null,
              riskClass: classification?.riskClass ?? null,
              languageConfidence: classification?.languageConfidence ?? null,
              excludedTopics: classification?.excludedTopics ?? null
            },
            rewrite: null
          }
        });
        await store.completeJob(job.id);
        result.skipped += 1;
        continue;
      }

      await store.updateSourcePost(sourcePost.id, {
        state: "rewrite_pending",
        canonical_category: classification.category,
        risk_class: classification.riskClass
      });

      const templateVariant = assignTemplateVariant(sourcePost.x_user_id, settings.templateWeights);
      const rewriteResult = await rewrite({ text: decrypted.text });
      const validated = validateRewrite({ original: decrypted.text, rewriteResult, templateVariant });
      const classificationDiagnostics = {
        eligible: true,
        reason: null,
        category: classification.category,
        riskClass: classification.riskClass,
        languageConfidence: classification.languageConfidence,
        excludedTopics: classification.excludedTopics
      };
      if (!validated.eligible) {
        log("[social-pipeline] rewrite decision", {
          sourcePostId: sourcePost.id,
          creatorBucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
          stage: "rewrite",
          eligible: false,
          reason: validated.reason,
          factsChanged: validated.detail ?? null
        });
        await skipSource({
          store,
          config,
          encryptionKey,
          sourcePost,
          reason: validated.reason,
          detail: validated.detail,
          category: classification.category,
          riskClass: classification.riskClass,
          diagnostics: {
            screening: { eligible: true, reason: null },
            classification: classificationDiagnostics,
            rewrite: { eligible: false, reason: validated.reason, factsChanged: validated.detail ?? null }
          }
        });
        await store.completeJob(job.id);
        result.skipped += 1;
        continue;
      }

      const expiresAt = new Date(new Date(sourcePost.posted_at).getTime() + settings.maxSourceAgeHours * 60 * 60 * 1000);
      const { id: candidateId, created } = await store.createCandidate({
        sourcePostId: sourcePost.id,
        xUserId: sourcePost.x_user_id,
        templateVariant,
        canonicalCategory: classification.category,
        reply: encryptJson(encryptionKey, { replyText: validated.replyText, replacement: validated.replacement }),
        expiresAt
      });
      await store.updateSourcePost(sourcePost.id, {
        state: "queued",
        diagnostics: {
          screening: { eligible: true, reason: null },
          classification: classificationDiagnostics,
          rewrite: { eligible: true, reason: null, factsChanged: null }
        }
      });
      await store.completeJob(job.id);

      if (!created) continue;
      result.queued += 1;

      log("[social-pipeline] queued decision", {
        sourcePostId: sourcePost.id,
        creatorBucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
        stage: "queued",
        candidateId,
        category: classification.category,
        templateVariant
      });

      await store.appendAudit({
        actor: "system",
        action: "candidate_queued",
        subjectType: "candidate",
        subjectId: candidateId,
        nextValue: { templateVariant, category: classification.category, expiresAt }
      });
      const expiresInMinutes = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
      await enqueuePostHogEvent(store, {
        name: "social rewrite queued",
        distinctId: creatorBucket(sourcePost.x_user_id, encryptionKey),
        idempotencyKey: `queued:${candidateId}`,
        properties: {
          campaign: config.campaignId,
          template_variant: templateVariant,
          category: classification.category,
          creator_bucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
          queue_expiry_minutes: expiresInMinutes
        }
      });
      await enqueueSlackNotification(store, {
        kind: "draft_queued",
        idempotencyKey: `draft-queued:${candidateId}`,
        fields: {
          candidate_id: candidateId,
          template_variant: templateVariant,
          category: classification.category,
          creator_bucket: creatorBucket(sourcePost.x_user_id, encryptionKey),
          expires_in_minutes: expiresInMinutes
        }
      });
    } catch (error) {
      result.failed += 1;
      log("[social-pipeline] screening job failed", {
        jobId: job.id,
        attempt: job.attempt_count,
        code: error.code ?? "unknown",
        message: error.message
      });
      const failed = await store.failJob(job.id, {
        error: error.message,
        signature: error.code ?? "unknown",
        backoffMs: backoffFor(job.attempt_count)
      });
      if (failed?.state === "failed") {
        await enqueueSlackNotification(store, {
          kind: "job_failed",
          idempotencyKey: `job-failed:${job.id}`,
          fields: {
            kind: SCREENING_JOB_KIND,
            failure_signature: error.code ?? "unknown",
            attempt_count: job.attempt_count
          }
        });
      }
    }
  }

  return result;
}

// posted_pending_verification is excluded: the human may already have posted
// the reply on X, so only verification or an operator can close it.
export async function expireStaleCandidates({ store, config, encryptionKey, now = new Date() }) {
  const open = await store.listCandidatesByState(["queued", "composer_opened"], 200);
  let expired = 0;
  for (const candidate of open) {
    if (new Date(candidate.expires_at).getTime() > now.getTime()) continue;
    await store.updateCandidate(candidate.id, { state: "expired", state_reason: "source_older_than_window" });
    await store.appendAudit({
      actor: "system",
      action: "candidate_expired",
      subjectType: "candidate",
      subjectId: candidate.id,
      previousValue: { state: candidate.state },
      nextValue: { state: "expired" }
    });
    await enqueuePostHogEvent(store, {
      name: "social candidate skipped",
      distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
      idempotencyKey: `expired:${candidate.id}`,
      properties: {
        campaign: config.campaignId,
        creator_bucket: creatorBucket(candidate.x_user_id, encryptionKey),
        skip_reason: "expired",
        category: candidate.canonical_category,
        risk_class: null,
        policy_version: SOCIAL_POLICY_VERSION
      }
    });
    expired += 1;
  }
  return expired;
}
