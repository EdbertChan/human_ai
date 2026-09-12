import { randomUUID } from "node:crypto";

export class BlocklistViolationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlocklistViolationError";
    this.code = "creator_blocked";
  }
}

// "failed" here is specifically an ambiguous auto-post outcome (X's response
// never arrived, so it's unknown whether the tweet posted) -- it must stay
// visible in the queue for an operator to reconcile, never silently drop out.
const OPEN_CANDIDATE_STATES = ["queued", "composer_opened", "posted_pending_verification", "failed"];

// How long a claimed outbox row stays invisible to other workers while its
// delivery is in flight.
export const OUTBOX_CLAIM_LEASE_MS = 5 * 60 * 1000;

export { OPEN_CANDIDATE_STATES };

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

export function createMemorySocialStore({ clock = () => new Date() } = {}) {
  const settingsVersions = [];
  const xWriteCredentials = [];
  const creators = new Map();
  const sourcePosts = new Map();
  const sourcePostsByXId = new Map();
  const candidates = new Map();
  const candidatesBySource = new Map();
  const metrics = new Map();
  const jobs = new Map();
  const jobsByDedupe = new Map();
  const outbox = new Map();
  const outboxByKey = new Map();
  const objections = [];
  const spend = new Map();
  const audit = [];
  const runtimeState = new Map();

  return {
    async getActiveSettings() {
      const row = settingsVersions.find((item) => item.active);
      return row ? clone(row) : null;
    },

    async saveSettings({ settings, changedBy, reason = null }) {
      for (const row of settingsVersions) row.active = false;
      const row = {
        version: settingsVersions.length + 1,
        active: true,
        settings: clone(settings),
        changed_by: changedBy,
        change_reason: reason,
        created_at: clock()
      };
      settingsVersions.push(row);
      return clone(row);
    },

    async listSettingsVersions() {
      return settingsVersions.map(clone);
    },

    async saveXWriteCredential({ xUserId, handle, accessToken, accessTokenExpiresAt, refreshToken, scopes, connectedBy }) {
      for (const row of xWriteCredentials) row.active = false;
      const row = {
        id: randomUUID(),
        active: true,
        x_user_id: xUserId,
        handle,
        access_token_ciphertext: accessToken.ciphertext,
        access_token_iv: accessToken.iv,
        access_token_tag: accessToken.tag,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_ciphertext: refreshToken.ciphertext,
        refresh_token_iv: refreshToken.iv,
        refresh_token_tag: refreshToken.tag,
        scopes,
        connected_by: connectedBy,
        connected_at: clock(),
        revoked_at: null,
        last_refresh_error: null,
        updated_at: clock()
      };
      xWriteCredentials.push(row);
      return clone(row);
    },

    async getActiveXWriteCredential() {
      const row = xWriteCredentials.find((item) => item.active);
      return row ? clone(row) : null;
    },

    async updateXWriteCredentialTokens(id, { accessToken, accessTokenExpiresAt, refreshToken }) {
      const row = xWriteCredentials.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, {
        access_token_ciphertext: accessToken.ciphertext,
        access_token_iv: accessToken.iv,
        access_token_tag: accessToken.tag,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_ciphertext: refreshToken.ciphertext,
        refresh_token_iv: refreshToken.iv,
        refresh_token_tag: refreshToken.tag,
        last_refresh_error: null,
        updated_at: clock()
      });
      return clone(row);
    },

    async recordXWriteCredentialError(id, message) {
      const row = xWriteCredentials.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, { last_refresh_error: message, updated_at: clock() });
      return clone(row);
    },

    async listCreators() {
      return [...creators.values()].map(clone);
    },

    async getCreator(xUserId) {
      const row = creators.get(xUserId);
      return row ? clone(row) : null;
    },

    async upsertCreator({ xUserId, handle, notes = null, addedBy }) {
      const existing = creators.get(xUserId);
      if (existing?.status === "blocked") {
        throw new BlocklistViolationError(`Creator ${xUserId} is permanently blocklisted.`);
      }
      const row = existing ?? {
        x_user_id: xUserId,
        since_id: null,
        last_scanned_at: null,
        last_posted_at: null,
        created_at: clock()
      };
      Object.assign(row, { handle, status: "allowed", notes, added_by: addedBy, updated_at: clock() });
      creators.set(xUserId, row);
      return clone(row);
    },

    async blockCreator({ xUserId, handle = null, notes = null, blockedBy }) {
      const row = creators.get(xUserId) ?? {
        x_user_id: xUserId,
        handle: handle ?? xUserId,
        since_id: null,
        last_scanned_at: null,
        last_posted_at: null,
        added_by: blockedBy,
        created_at: clock()
      };
      Object.assign(row, {
        status: "blocked",
        notes: notes ?? row.notes ?? null,
        handle: handle ?? row.handle,
        updated_at: clock()
      });
      creators.set(xUserId, row);
      return clone(row);
    },

    async removeCreator({ xUserId }) {
      const row = creators.get(xUserId);
      if (!row) return null;
      Object.assign(row, { status: "removed", updated_at: clock() });
      creators.set(xUserId, row);
      return clone(row);
    },

    async updateCreatorScan({ xUserId, sinceId, lastScannedAt }) {
      const row = creators.get(xUserId);
      if (!row) return null;
      if (sinceId) row.since_id = sinceId;
      row.last_scanned_at = lastScannedAt;
      row.updated_at = clock();
      return clone(row);
    },

    async markCreatorPosted({ xUserId, postedAt }) {
      const row = creators.get(xUserId);
      if (!row) return null;
      row.last_posted_at = postedAt;
      row.updated_at = clock();
      return clone(row);
    },

    async insertSourcePost({ xPostId, xUserId, postedAt, lang, text }) {
      const existingId = sourcePostsByXId.get(xPostId);
      if (existingId) return { id: existingId, created: false };
      const id = randomUUID();
      const row = {
        id,
        x_post_id: xPostId,
        x_user_id: xUserId,
        posted_at: postedAt,
        lang: lang ?? null,
        state: "discovered",
        skip_reason: null,
        canonical_category: null,
        risk_class: null,
        diagnostics: null,
        text_ciphertext: text?.ciphertext ?? null,
        text_iv: text?.iv ?? null,
        text_tag: text?.tag ?? null,
        text_purged_at: null,
        discovered_at: clock(),
        updated_at: clock()
      };
      sourcePosts.set(id, row);
      sourcePostsByXId.set(xPostId, id);
      return { id, created: true };
    },

    async getSourcePost(id) {
      const row = sourcePosts.get(id);
      return row ? clone(row) : null;
    },

    async listSourcePostsByState(states, limit = 25) {
      return [...sourcePosts.values()]
        .filter((row) => states.includes(row.state))
        .slice(0, limit)
        .map(clone);
    },

    async listSourcePostsRecent({ limit = 100 } = {}) {
      return [...sourcePosts.values()]
        .sort((a, b) => new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime())
        .slice(0, limit)
        .map(clone);
    },

    async updateSourcePost(id, patch) {
      const row = sourcePosts.get(id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: clock() });
      return clone(row);
    },

    async createCandidate({ sourcePostId, xUserId, templateVariant, canonicalCategory, reply, expiresAt }) {
      if (candidatesBySource.has(sourcePostId)) {
        return { id: candidatesBySource.get(sourcePostId), created: false };
      }
      const id = randomUUID();
      const row = {
        id,
        source_post_id: sourcePostId,
        x_user_id: xUserId,
        state: "queued",
        state_reason: null,
        template_variant: templateVariant,
        canonical_category: canonicalCategory,
        reply_ciphertext: reply.ciphertext,
        reply_iv: reply.iv,
        reply_tag: reply.tag,
        posted_ciphertext: null,
        posted_iv: null,
        posted_tag: null,
        protocol_deviation: false,
        reply_x_post_id: null,
        reply_url: null,
        expires_at: expiresAt,
        composer_opened_at: null,
        composer_opened_by: null,
        posted_at: null,
        posted_pacific_date: null,
        verified_by: null,
        closed_by: null,
        text_purged_at: null,
        created_at: clock(),
        updated_at: clock()
      };
      candidates.set(id, row);
      candidatesBySource.set(sourcePostId, id);
      return { id, created: true };
    },

    async getCandidate(id) {
      const row = candidates.get(id);
      return row ? clone(row) : null;
    },

    async getCandidateBySourcePost(sourcePostId) {
      const id = candidatesBySource.get(sourcePostId);
      return id ? clone(candidates.get(id)) : null;
    },

    async listCandidatesByState(states, limit = 50) {
      return [...candidates.values()]
        .filter((row) => states.includes(row.state))
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, limit)
        .map(clone);
    },

    async updateCandidate(id, patch) {
      const row = candidates.get(id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: clock() });
      return clone(row);
    },

    async countPostedOnPacificDate(dateKey) {
      // deletion_required/deleted candidates were verified-posted that day
      // too; an objection must not hand the daily cap slot back.
      return [...candidates.values()].filter(
        (row) => ["posted", "deletion_required", "deleted"].includes(row.state) && row.posted_pacific_date === dateKey
      ).length;
    },

    async findCandidateByReplyPostId(replyXPostId) {
      const row = [...candidates.values()].find((item) => item.reply_x_post_id === replyXPostId);
      return row ? clone(row) : null;
    },

    async insertMetricsSnapshot({ candidateId, bucketHours, impressions, likes, replies, reposts, quotes }) {
      const key = `${candidateId}:${bucketHours}`;
      if (metrics.has(key)) return { created: false };
      metrics.set(key, {
        id: randomUUID(),
        candidate_id: candidateId,
        bucket_hours: bucketHours,
        impressions,
        likes,
        replies,
        reposts,
        quotes,
        captured_at: clock()
      });
      return { created: true };
    },

    async listMetricsSnapshots(candidateId) {
      return [...metrics.values()].filter((row) => row.candidate_id === candidateId).map(clone);
    },

    async enqueueJob({ kind, dedupeKey, payload = {}, runAt = clock(), maxAttempts = 5 }) {
      if (jobsByDedupe.has(dedupeKey)) return { id: jobsByDedupe.get(dedupeKey), created: false };
      const id = randomUUID();
      jobs.set(id, {
        id,
        kind,
        dedupe_key: dedupeKey,
        payload: clone(payload),
        state: "pending",
        attempt_count: 0,
        max_attempts: maxAttempts,
        next_attempt_at: runAt,
        claimed_at: null,
        last_error: null,
        failure_signature: null,
        created_at: clock(),
        updated_at: clock()
      });
      jobsByDedupe.set(dedupeKey, id);
      return { id, created: true };
    },

    async claimJobs({ kinds, limit = 10, now = clock() }) {
      const claimed = [];
      for (const row of jobs.values()) {
        if (claimed.length >= limit) break;
        if (row.state !== "pending") continue;
        if (kinds && !kinds.includes(row.kind)) continue;
        if (row.next_attempt_at > now) continue;
        if (row.attempt_count >= row.max_attempts) continue;
        row.state = "claimed";
        row.claimed_at = now;
        row.attempt_count += 1;
        row.updated_at = now;
        claimed.push(clone(row));
      }
      return claimed;
    },

    async completeJob(id) {
      const row = jobs.get(id);
      if (!row) return;
      row.state = "done";
      row.last_error = null;
      row.updated_at = clock();
    },

    async failJob(id, { error, signature, backoffMs = 60_000 }) {
      const row = jobs.get(id);
      if (!row) return null;
      row.last_error = String(error).slice(0, 500);
      row.failure_signature = signature ?? null;
      if (row.attempt_count >= row.max_attempts) {
        row.state = "failed";
      } else {
        row.state = "pending";
        row.next_attempt_at = new Date(clock().getTime() + backoffMs);
      }
      row.updated_at = clock();
      return clone(row);
    },

    async recoverAbandonedJobs({ olderThanMs, now = clock() }) {
      // A job whose worker dies (timeout/OOM) never reaches failJob, so the
      // watchdog itself must enforce max_attempts or the job retries forever.
      let count = 0;
      for (const row of jobs.values()) {
        if (row.state !== "claimed") continue;
        if (now - row.claimed_at < olderThanMs) continue;
        if (row.attempt_count >= row.max_attempts) {
          row.state = "failed";
          row.failure_signature = row.failure_signature ?? "abandoned";
          row.last_error = row.last_error ?? "Job claim abandoned after max attempts.";
        } else {
          row.state = "pending";
        }
        row.claimed_at = null;
        row.updated_at = now;
        count += 1;
      }
      return count;
    },

    async listFailedJobs(limit = 25) {
      return [...jobs.values()].filter((row) => row.state === "failed").slice(0, limit).map(clone);
    },

    async enqueueOutboxEvent({ destination, idempotencyKey, eventName, payload, maxAttempts = 8 }) {
      const key = `${destination}:${idempotencyKey}`;
      if (outboxByKey.has(key)) return { id: outboxByKey.get(key), created: false };
      const id = randomUUID();
      outbox.set(id, {
        id,
        destination,
        idempotency_key: idempotencyKey,
        event_name: eventName,
        payload: clone(payload),
        state: "pending",
        attempt_count: 0,
        max_attempts: maxAttempts,
        next_attempt_at: clock(),
        last_error: null,
        created_at: clock(),
        delivered_at: null
      });
      outboxByKey.set(key, id);
      return { id, created: true };
    },

    async claimOutboxEvents({ limit = 20, now = clock(), destinations = null }) {
      const claimed = [];
      for (const row of outbox.values()) {
        if (claimed.length >= limit) break;
        if (row.state !== "pending") continue;
        if (destinations && !destinations.includes(row.destination)) continue;
        if (row.next_attempt_at > now) continue;
        row.attempt_count += 1;
        // Push the row out of reach while delivery is in flight so an
        // overlapping cron cannot send the same event twice.
        row.next_attempt_at = new Date(now.getTime() + OUTBOX_CLAIM_LEASE_MS);
        claimed.push(clone(row));
      }
      return claimed;
    },

    async markOutboxDelivered(id) {
      const row = outbox.get(id);
      if (!row) return;
      row.state = "delivered";
      row.delivered_at = clock();
      row.last_error = null;
    },

    async markOutboxFailed(id, { error, backoffMs = 60_000 }) {
      const row = outbox.get(id);
      if (!row) return null;
      row.last_error = String(error).slice(0, 500);
      if (row.attempt_count >= row.max_attempts) {
        row.state = "failed";
      } else {
        row.next_attempt_at = new Date(clock().getTime() + backoffMs);
      }
      return clone(row);
    },

    async outboxStats() {
      const stats = {
        pending: 0,
        delivered: 0,
        failed: 0,
        byDestination: {
          posthog: { pending: 0, delivered: 0, failed: 0 },
          slack: { pending: 0, delivered: 0, failed: 0 }
        }
      };
      for (const row of outbox.values()) {
        stats[row.state] += 1;
        if (stats.byDestination[row.destination]) stats.byDestination[row.destination][row.state] += 1;
      }
      return stats;
    },

    async getRuntimeState(key) {
      return runtimeState.has(key) ? clone(runtimeState.get(key)) : null;
    },

    async setRuntimeState(key, value) {
      runtimeState.set(key, clone(value));
      return clone(value);
    },

    async recordObjection({ candidateId = null, xUserId, objectionClass, recordedBy }) {
      const row = {
        id: randomUUID(),
        candidate_id: candidateId,
        x_user_id: xUserId,
        objection_class: objectionClass,
        recorded_by: recordedBy,
        recorded_at: clock()
      };
      objections.push(row);
      return clone(row);
    },

    async countObjectionsSince(since) {
      return objections.filter((row) => row.recorded_at >= since).length;
    },

    async addXReads({ month, reads, micros }) {
      const row = spend.get(month) ?? { month, reads: 0, estimated_micros: 0, alerted_thresholds: [], updated_at: clock() };
      row.reads += reads;
      row.estimated_micros += micros;
      row.updated_at = clock();
      spend.set(month, row);
      return clone(row);
    },

    async getXSpend(month) {
      const row = spend.get(month);
      return row ? clone(row) : { month, reads: 0, estimated_micros: 0, alerted_thresholds: [] };
    },

    async markSpendAlert(month, threshold) {
      const row = spend.get(month) ?? { month, reads: 0, estimated_micros: 0, alerted_thresholds: [], updated_at: clock() };
      if (!row.alerted_thresholds.includes(threshold)) row.alerted_thresholds.push(threshold);
      spend.set(month, row);
      return clone(row);
    },

    async appendAudit({ actor, action, subjectType = null, subjectId = null, previousValue = null, nextValue = null }) {
      const row = {
        id: audit.length + 1,
        actor,
        action,
        subject_type: subjectType,
        subject_id: subjectId,
        previous_value: clone(previousValue),
        next_value: clone(nextValue),
        created_at: clock()
      };
      audit.push(row);
      return clone(row);
    },

    async listAudit(limit = 100) {
      return audit.slice(-limit).reverse().map(clone);
    },

    async purgeExpiredText(cutoff) {
      let purged = 0;
      for (const row of sourcePosts.values()) {
        if (row.text_purged_at || row.discovered_at > cutoff) continue;
        if (!row.text_ciphertext) continue;
        Object.assign(row, { text_ciphertext: null, text_iv: null, text_tag: null, text_purged_at: clock() });
        purged += 1;
      }
      for (const row of candidates.values()) {
        if (row.text_purged_at || row.created_at > cutoff) continue;
        if (!row.reply_ciphertext && !row.posted_ciphertext) continue;
        Object.assign(row, {
          reply_ciphertext: null,
          reply_iv: null,
          reply_tag: null,
          posted_ciphertext: null,
          posted_iv: null,
          posted_tag: null,
          text_purged_at: clock()
        });
        purged += 1;
      }
      return purged;
    },

    async clearActivityAndQueue() {
      const clearedPosts = sourcePosts.size;
      const clearedCandidates = candidates.size;
      const clearedMetrics = metrics.size;
      const candidateIds = new Set(candidates.keys());
      for (let i = objections.length - 1; i >= 0; i -= 1) {
        if (objections[i].candidate_id && candidateIds.has(objections[i].candidate_id)) objections.splice(i, 1);
      }
      metrics.clear();
      candidates.clear();
      candidatesBySource.clear();
      sourcePosts.clear();
      sourcePostsByXId.clear();
      return { clearedPosts, clearedCandidates, clearedMetrics };
    }
  };
}

export function createPostgresSocialStore(pool) {
  return {
    async getActiveSettings() {
      const { rows } = await pool.query(`SELECT * FROM social_campaign_settings WHERE active LIMIT 1`);
      return rows[0] ?? null;
    },

    async saveSettings({ settings, changedBy, reason = null }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE social_campaign_settings SET active = FALSE WHERE active`);
        const { rows } = await client.query(
          `INSERT INTO social_campaign_settings (version, active, settings, changed_by, change_reason)
           VALUES ((SELECT COALESCE(MAX(version), 0) + 1 FROM social_campaign_settings), TRUE, $1, $2, $3)
           RETURNING *`,
          [JSON.stringify(settings), changedBy, reason]
        );
        await client.query("COMMIT");
        return rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async listSettingsVersions() {
      const { rows } = await pool.query(`SELECT * FROM social_campaign_settings ORDER BY version DESC LIMIT 50`);
      return rows;
    },

    async saveXWriteCredential({ xUserId, handle, accessToken, accessTokenExpiresAt, refreshToken, scopes, connectedBy }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE social_x_write_credentials SET active = FALSE WHERE active`);
        const { rows } = await client.query(
          `INSERT INTO social_x_write_credentials (
             id, active, x_user_id, handle,
             access_token_ciphertext, access_token_iv, access_token_tag, access_token_expires_at,
             refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
             scopes, connected_by
           ) VALUES (gen_random_uuid(), TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            xUserId,
            handle,
            accessToken.ciphertext,
            accessToken.iv,
            accessToken.tag,
            accessTokenExpiresAt,
            refreshToken.ciphertext,
            refreshToken.iv,
            refreshToken.tag,
            scopes,
            connectedBy
          ]
        );
        await client.query("COMMIT");
        return rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getActiveXWriteCredential() {
      const { rows } = await pool.query(`SELECT * FROM social_x_write_credentials WHERE active LIMIT 1`);
      return rows[0] ?? null;
    },

    async updateXWriteCredentialTokens(id, { accessToken, accessTokenExpiresAt, refreshToken }) {
      const { rows } = await pool.query(
        `UPDATE social_x_write_credentials
         SET access_token_ciphertext = $2, access_token_iv = $3, access_token_tag = $4, access_token_expires_at = $5,
             refresh_token_ciphertext = $6, refresh_token_iv = $7, refresh_token_tag = $8,
             last_refresh_error = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, accessToken.ciphertext, accessToken.iv, accessToken.tag, accessTokenExpiresAt, refreshToken.ciphertext, refreshToken.iv, refreshToken.tag]
      );
      return rows[0] ?? null;
    },

    async recordXWriteCredentialError(id, message) {
      const { rows } = await pool.query(
        `UPDATE social_x_write_credentials SET last_refresh_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, message]
      );
      return rows[0] ?? null;
    },

    async listCreators() {
      const { rows } = await pool.query(`SELECT * FROM social_creators ORDER BY handle`);
      return rows;
    },

    async getCreator(xUserId) {
      const { rows } = await pool.query(`SELECT * FROM social_creators WHERE x_user_id = $1`, [xUserId]);
      return rows[0] ?? null;
    },

    async upsertCreator({ xUserId, handle, notes = null, addedBy }) {
      const { rows } = await pool.query(
        `INSERT INTO social_creators (x_user_id, handle, status, notes, added_by)
         VALUES ($1, $2, 'allowed', $3, $4)
         ON CONFLICT (x_user_id) DO UPDATE
           SET handle = EXCLUDED.handle, notes = EXCLUDED.notes, status = 'allowed', updated_at = NOW()
           WHERE social_creators.status <> 'blocked'
         RETURNING *`,
        [xUserId, handle, notes, addedBy]
      );
      if (!rows[0]) throw new BlocklistViolationError(`Creator ${xUserId} is permanently blocklisted.`);
      return rows[0];
    },

    async blockCreator({ xUserId, handle = null, notes = null, blockedBy }) {
      const { rows } = await pool.query(
        `INSERT INTO social_creators (x_user_id, handle, status, notes, added_by)
         VALUES ($1, COALESCE($2, $1), 'blocked', $3, $4)
         ON CONFLICT (x_user_id) DO UPDATE
           SET status = 'blocked',
               notes = COALESCE(EXCLUDED.notes, social_creators.notes),
               updated_at = NOW()
         RETURNING *`,
        [xUserId, handle, notes, blockedBy]
      );
      return rows[0];
    },

    async removeCreator({ xUserId }) {
      const { rows } = await pool.query(
        `UPDATE social_creators SET status = 'removed', updated_at = NOW() WHERE x_user_id = $1 RETURNING *`,
        [xUserId]
      );
      return rows[0] ?? null;
    },

    async updateCreatorScan({ xUserId, sinceId, lastScannedAt }) {
      const { rows } = await pool.query(
        `UPDATE social_creators
         SET since_id = COALESCE($2, since_id), last_scanned_at = $3, updated_at = NOW()
         WHERE x_user_id = $1 RETURNING *`,
        [xUserId, sinceId ?? null, lastScannedAt]
      );
      return rows[0] ?? null;
    },

    async markCreatorPosted({ xUserId, postedAt }) {
      const { rows } = await pool.query(
        `UPDATE social_creators SET last_posted_at = $2, updated_at = NOW() WHERE x_user_id = $1 RETURNING *`,
        [xUserId, postedAt]
      );
      return rows[0] ?? null;
    },

    async insertSourcePost({ xPostId, xUserId, postedAt, lang, text }) {
      const { rows } = await pool.query(
        `INSERT INTO social_source_posts (
           id, x_post_id, x_user_id, posted_at, lang, state, text_ciphertext, text_iv, text_tag
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'discovered', $5, $6, $7)
         ON CONFLICT (x_post_id) DO NOTHING
         RETURNING id`,
        [xPostId, xUserId, postedAt, lang ?? null, text?.ciphertext ?? null, text?.iv ?? null, text?.tag ?? null]
      );
      if (rows[0]) return { id: rows[0].id, created: true };
      const existing = await pool.query(`SELECT id FROM social_source_posts WHERE x_post_id = $1`, [xPostId]);
      return { id: existing.rows[0].id, created: false };
    },

    async getSourcePost(id) {
      const { rows } = await pool.query(`SELECT * FROM social_source_posts WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async listSourcePostsByState(states, limit = 25) {
      const { rows } = await pool.query(
        `SELECT * FROM social_source_posts WHERE state = ANY($1) ORDER BY discovered_at LIMIT $2`,
        [states, limit]
      );
      return rows;
    },

    async listSourcePostsRecent({ limit = 100 } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM social_source_posts ORDER BY discovered_at DESC LIMIT $1`,
        [limit]
      );
      return rows;
    },

    async updateSourcePost(id, patch) {
      const { text, values } = buildUpdate(patch, 2);
      const { rows } = await pool.query(
        `UPDATE social_source_posts SET ${text}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values]
      );
      return rows[0] ?? null;
    },

    async createCandidate({ sourcePostId, xUserId, templateVariant, canonicalCategory, reply, expiresAt }) {
      const { rows } = await pool.query(
        `INSERT INTO social_reply_candidates (
           id, source_post_id, x_user_id, state, template_variant, canonical_category,
           reply_ciphertext, reply_iv, reply_tag, expires_at
         ) VALUES (gen_random_uuid(), $1, $2, 'queued', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_post_id) DO NOTHING
         RETURNING id`,
        [sourcePostId, xUserId, templateVariant, canonicalCategory, reply.ciphertext, reply.iv, reply.tag, expiresAt]
      );
      if (rows[0]) return { id: rows[0].id, created: true };
      const existing = await pool.query(`SELECT id FROM social_reply_candidates WHERE source_post_id = $1`, [sourcePostId]);
      return { id: existing.rows[0].id, created: false };
    },

    async getCandidate(id) {
      const { rows } = await pool.query(`SELECT * FROM social_reply_candidates WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async getCandidateBySourcePost(sourcePostId) {
      const { rows } = await pool.query(`SELECT * FROM social_reply_candidates WHERE source_post_id = $1`, [sourcePostId]);
      return rows[0] ?? null;
    },

    async listCandidatesByState(states, limit = 50) {
      const { rows } = await pool.query(
        `SELECT * FROM social_reply_candidates WHERE state = ANY($1) ORDER BY created_at LIMIT $2`,
        [states, limit]
      );
      return rows;
    },

    async updateCandidate(id, patch) {
      const { text, values } = buildUpdate(patch, 2);
      const { rows } = await pool.query(
        `UPDATE social_reply_candidates SET ${text}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values]
      );
      return rows[0] ?? null;
    },

    async countPostedOnPacificDate(dateKey) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM social_reply_candidates
         WHERE state IN ('posted', 'deletion_required', 'deleted') AND posted_pacific_date = $1`,
        [dateKey]
      );
      return rows[0].count;
    },

    async findCandidateByReplyPostId(replyXPostId) {
      const { rows } = await pool.query(`SELECT * FROM social_reply_candidates WHERE reply_x_post_id = $1`, [replyXPostId]);
      return rows[0] ?? null;
    },

    async insertMetricsSnapshot({ candidateId, bucketHours, impressions, likes, replies, reposts, quotes }) {
      const { rowCount } = await pool.query(
        `INSERT INTO social_metrics_snapshots (id, candidate_id, bucket_hours, impressions, likes, replies, reposts, quotes)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (candidate_id, bucket_hours) DO NOTHING`,
        [candidateId, bucketHours, impressions, likes, replies, reposts, quotes]
      );
      return { created: rowCount > 0 };
    },

    async listMetricsSnapshots(candidateId) {
      const { rows } = await pool.query(
        `SELECT * FROM social_metrics_snapshots WHERE candidate_id = $1 ORDER BY bucket_hours`,
        [candidateId]
      );
      return rows;
    },

    // Unlike createMemorySocialStore, this default isn't behind a clock
    // injection — safe only because scanner.js, the sole caller, always
    // passes runAt explicitly. If a new caller omits it, this silently
    // falls back to the real wall clock; thread runAt through instead of
    // relying on this default.
    async enqueueJob({ kind, dedupeKey, payload = {}, runAt = new Date(), maxAttempts = 5 }) {
      const { rows } = await pool.query(
        `INSERT INTO social_jobs (id, kind, dedupe_key, payload, state, max_attempts, next_attempt_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'pending', $4, $5)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id`,
        [kind, dedupeKey, JSON.stringify(payload), maxAttempts, runAt]
      );
      if (rows[0]) return { id: rows[0].id, created: true };
      const existing = await pool.query(`SELECT id FROM social_jobs WHERE dedupe_key = $1`, [dedupeKey]);
      return { id: existing.rows[0].id, created: false };
    },

    async claimJobs({ kinds, limit = 10 }) {
      const { rows } = await pool.query(
        `UPDATE social_jobs SET state = 'claimed', claimed_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
         WHERE id IN (
           SELECT id FROM social_jobs
           WHERE state = 'pending' AND next_attempt_at <= NOW() AND attempt_count < max_attempts
             AND ($1::text[] IS NULL OR kind = ANY($1))
           ORDER BY next_attempt_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [kinds ?? null, limit]
      );
      return rows;
    },

    async completeJob(id) {
      await pool.query(`UPDATE social_jobs SET state = 'done', last_error = NULL, updated_at = NOW() WHERE id = $1`, [id]);
    },

    async failJob(id, { error, signature, backoffMs = 60_000 }) {
      const { rows } = await pool.query(
        `UPDATE social_jobs
         SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
             next_attempt_at = NOW() + ($3::text || ' milliseconds')::interval,
             last_error = $2,
             failure_signature = $4,
             updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, String(error).slice(0, 500), String(backoffMs), signature ?? null]
      );
      return rows[0] ?? null;
    },

    async recoverAbandonedJobs({ olderThanMs }) {
      const { rowCount } = await pool.query(
        `UPDATE social_jobs
         SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
             failure_signature = CASE
               WHEN attempt_count >= max_attempts THEN COALESCE(failure_signature, 'abandoned')
               ELSE failure_signature
             END,
             last_error = CASE
               WHEN attempt_count >= max_attempts THEN COALESCE(last_error, 'Job claim abandoned after max attempts.')
               ELSE last_error
             END,
             claimed_at = NULL,
             updated_at = NOW()
         WHERE state = 'claimed' AND claimed_at < NOW() - ($1::text || ' milliseconds')::interval`,
        [String(olderThanMs)]
      );
      return rowCount ?? 0;
    },

    async listFailedJobs(limit = 25) {
      const { rows } = await pool.query(`SELECT * FROM social_jobs WHERE state = 'failed' ORDER BY updated_at DESC LIMIT $1`, [limit]);
      return rows;
    },

    async enqueueOutboxEvent({ destination, idempotencyKey, eventName, payload, maxAttempts = 8 }) {
      const { rows } = await pool.query(
        `INSERT INTO social_event_outbox (id, destination, idempotency_key, event_name, payload, state, max_attempts)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (destination, idempotency_key) DO NOTHING
         RETURNING id`,
        [destination, idempotencyKey, eventName, JSON.stringify(payload), maxAttempts]
      );
      if (rows[0]) return { id: rows[0].id, created: true };
      const existing = await pool.query(
        `SELECT id FROM social_event_outbox WHERE destination = $1 AND idempotency_key = $2`,
        [destination, idempotencyKey]
      );
      return { id: existing.rows[0].id, created: false };
    },

    async claimOutboxEvents({ limit = 20, destinations = null }) {
      const { rows } = await pool.query(
        `UPDATE social_event_outbox
         SET attempt_count = attempt_count + 1,
             next_attempt_at = NOW() + ($2::text || ' milliseconds')::interval
         WHERE id IN (
           SELECT id FROM social_event_outbox
           WHERE state = 'pending' AND next_attempt_at <= NOW()
             AND ($3::text[] IS NULL OR destination = ANY($3))
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit, String(OUTBOX_CLAIM_LEASE_MS), destinations]
      );
      return rows;
    },

    async markOutboxDelivered(id) {
      await pool.query(
        `UPDATE social_event_outbox SET state = 'delivered', delivered_at = NOW(), last_error = NULL WHERE id = $1`,
        [id]
      );
    },

    async markOutboxFailed(id, { error, backoffMs = 60_000 }) {
      const { rows } = await pool.query(
        `UPDATE social_event_outbox
         SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
             next_attempt_at = NOW() + ($3::text || ' milliseconds')::interval,
             last_error = $2
         WHERE id = $1 RETURNING *`,
        [id, String(error).slice(0, 500), String(backoffMs)]
      );
      return rows[0] ?? null;
    },

    async outboxStats() {
      const { rows } = await pool.query(
        `SELECT destination, state, COUNT(*)::int AS count FROM social_event_outbox GROUP BY destination, state`
      );
      const stats = {
        pending: 0,
        delivered: 0,
        failed: 0,
        byDestination: {
          posthog: { pending: 0, delivered: 0, failed: 0 },
          slack: { pending: 0, delivered: 0, failed: 0 }
        }
      };
      for (const row of rows) {
        stats[row.state] += row.count;
        if (stats.byDestination[row.destination]) stats.byDestination[row.destination][row.state] = row.count;
      }
      return stats;
    },

    async getRuntimeState(key) {
      const { rows } = await pool.query(`SELECT value FROM social_runtime_state WHERE key = $1`, [key]);
      return rows[0]?.value ?? null;
    },

    async setRuntimeState(key, value) {
      const { rows } = await pool.query(
        `INSERT INTO social_runtime_state (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
         RETURNING value`,
        [key, JSON.stringify(value)]
      );
      return rows[0].value;
    },

    async recordObjection({ candidateId = null, xUserId, objectionClass, recordedBy }) {
      const { rows } = await pool.query(
        `INSERT INTO social_objections (id, candidate_id, x_user_id, objection_class, recorded_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING *`,
        [candidateId, xUserId, objectionClass, recordedBy]
      );
      return rows[0];
    },

    async countObjectionsSince(since) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM social_objections WHERE recorded_at >= $1`,
        [since]
      );
      return rows[0].count;
    },

    async addXReads({ month, reads, micros }) {
      const { rows } = await pool.query(
        `INSERT INTO social_x_spend (month, reads, estimated_micros)
         VALUES ($1, $2, $3)
         ON CONFLICT (month) DO UPDATE
           SET reads = social_x_spend.reads + EXCLUDED.reads,
               estimated_micros = social_x_spend.estimated_micros + EXCLUDED.estimated_micros,
               updated_at = NOW()
         RETURNING *`,
        [month, reads, micros]
      );
      return rows[0];
    },

    async getXSpend(month) {
      const { rows } = await pool.query(`SELECT * FROM social_x_spend WHERE month = $1`, [month]);
      return rows[0] ?? { month, reads: 0, estimated_micros: 0, alerted_thresholds: [] };
    },

    async markSpendAlert(month, threshold) {
      const { rows } = await pool.query(
        `INSERT INTO social_x_spend (month, alerted_thresholds) VALUES ($1, ARRAY[$2::int])
         ON CONFLICT (month) DO UPDATE
           SET alerted_thresholds = (
             SELECT ARRAY(SELECT DISTINCT unnest(social_x_spend.alerted_thresholds || ARRAY[$2::int]))
           ), updated_at = NOW()
         RETURNING *`,
        [month, threshold]
      );
      return rows[0];
    },

    async appendAudit({ actor, action, subjectType = null, subjectId = null, previousValue = null, nextValue = null }) {
      const { rows } = await pool.query(
        `INSERT INTO social_audit_log (actor, action, subject_type, subject_id, previous_value, next_value)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          actor,
          action,
          subjectType,
          subjectId,
          previousValue === null ? null : JSON.stringify(previousValue),
          nextValue === null ? null : JSON.stringify(nextValue)
        ]
      );
      return rows[0];
    },

    async listAudit(limit = 100) {
      const { rows } = await pool.query(`SELECT * FROM social_audit_log ORDER BY created_at DESC LIMIT $1`, [limit]);
      return rows;
    },

    async purgeExpiredText(cutoff) {
      const sources = await pool.query(
        `UPDATE social_source_posts
         SET text_ciphertext = NULL, text_iv = NULL, text_tag = NULL, text_purged_at = NOW(), updated_at = NOW()
         WHERE discovered_at <= $1 AND text_purged_at IS NULL AND text_ciphertext IS NOT NULL`,
        [cutoff]
      );
      const replies = await pool.query(
        `UPDATE social_reply_candidates
         SET reply_ciphertext = NULL, reply_iv = NULL, reply_tag = NULL,
             posted_ciphertext = NULL, posted_iv = NULL, posted_tag = NULL,
             text_purged_at = NOW(), updated_at = NOW()
         WHERE created_at <= $1 AND text_purged_at IS NULL
           AND (reply_ciphertext IS NOT NULL OR posted_ciphertext IS NOT NULL)`,
        [cutoff]
      );
      return (sources.rowCount ?? 0) + (replies.rowCount ?? 0);
    },

    async clearActivityAndQueue() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const metricsResult = await client.query(
          `DELETE FROM social_metrics_snapshots WHERE candidate_id IN (SELECT id FROM social_reply_candidates)`
        );
        await client.query(
          `DELETE FROM social_objections WHERE candidate_id IN (SELECT id FROM social_reply_candidates)`
        );
        const candidatesResult = await client.query(`DELETE FROM social_reply_candidates`);
        const postsResult = await client.query(`DELETE FROM social_source_posts`);
        await client.query("COMMIT");
        return {
          clearedPosts: postsResult.rowCount ?? 0,
          clearedCandidates: candidatesResult.rowCount ?? 0,
          clearedMetrics: metricsResult.rowCount ?? 0
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

const UPDATABLE_COLUMNS = new Set([
  "state",
  "state_reason",
  "skip_reason",
  "canonical_category",
  "risk_class",
  "diagnostics",
  "reply_ciphertext",
  "reply_iv",
  "reply_tag",
  "posted_ciphertext",
  "posted_iv",
  "posted_tag",
  "protocol_deviation",
  "reply_x_post_id",
  "reply_url",
  "composer_opened_at",
  "composer_opened_by",
  "posted_at",
  "posted_pacific_date",
  "verified_by",
  "closed_by",
  "text_ciphertext",
  "text_iv",
  "text_tag",
  "text_purged_at"
]);

function buildUpdate(patch, startIndex) {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw new Error("Update patch must not be empty.");
  const fragments = [];
  const values = [];
  entries.forEach(([column, value], offset) => {
    if (!UPDATABLE_COLUMNS.has(column)) throw new Error(`Column ${column} is not updatable.`);
    fragments.push(`${column} = $${startIndex + offset}`);
    values.push(value);
  });
  return { text: fragments.join(", "), values };
}
