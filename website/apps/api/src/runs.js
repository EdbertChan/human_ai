import { randomUUID } from "node:crypto";

export function createMemoryRunStore() {
  const rows = new Map();

  return {
    async createPending({ personaVersion, payload, expiresAt, id = randomUUID() }) {
      const now = new Date();
      const row = {
        id,
        status: "pending",
        payload_ciphertext: payload.ciphertext,
        payload_iv: payload.iv,
        payload_tag: payload.tag,
        result_ciphertext: null,
        result_iv: null,
        result_tag: null,
        error_code: null,
        persona_version: personaVersion,
        attempt_count: 0,
        created_at: now,
        updated_at: now,
        expires_at: expiresAt
      };
      rows.set(id, row);
      return { id };
    },

    async claim(id) {
      const row = rows.get(id);
      if (!row) return null;
      if (row.expires_at.getTime() <= Date.now()) return null;
      if (row.status !== "pending") return null;
      row.status = "processing";
      row.updated_at = new Date();
      row.attempt_count += 1;
      return cloneRow(row);
    },

    async reclaimStuck({ olderThanMs }) {
      const cutoff = Date.now() - olderThanMs;
      let count = 0;
      for (const row of rows.values()) {
        if (row.status !== "processing") continue;
        if (row.expires_at.getTime() <= Date.now()) continue;
        if (row.updated_at.getTime() > cutoff) continue;
        row.status = "pending";
        row.updated_at = new Date();
        count += 1;
      }
      return count;
    },

    async deleteExpired() {
      let count = 0;
      const now = Date.now();
      for (const [id, row] of rows.entries()) {
        if (row.expires_at.getTime() <= now) {
          rows.delete(id);
          count += 1;
        }
      }
      return count;
    },

    async markCompleted(id, result) {
      const row = rows.get(id);
      if (!row) return;
      row.status = "completed";
      row.result_ciphertext = result.ciphertext;
      row.result_iv = result.iv;
      row.result_tag = result.tag;
      row.error_code = null;
      row.updated_at = new Date();
    },

    async markFailed(id, errorCode) {
      const row = rows.get(id);
      if (!row) return;
      row.status = "failed";
      row.error_code = errorCode;
      row.updated_at = new Date();
    },

    async get(id) {
      const row = rows.get(id);
      return row ? cloneRow(row) : null;
    },

    // test helper
    _rows: rows
  };
}

function cloneRow(row) {
  return {
    ...row,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    expires_at: new Date(row.expires_at)
  };
}

export function createPostgresRunStore(pool) {
  return {
    async createPending({ personaVersion, payload, expiresAt, id = randomUUID() }) {
      await pool.query(
        `INSERT INTO rewrite_runs (
          id, status, payload_ciphertext, payload_iv, payload_tag,
          persona_version, attempt_count, expires_at
        ) VALUES ($1, 'pending', $2, $3, $4, $5, 0, $6)`,
        [id, payload.ciphertext, payload.iv, payload.tag, personaVersion, expiresAt]
      );
      return { id };
    },

    async claim(id) {
      const result = await pool.query(
        `UPDATE rewrite_runs
         SET status = 'processing',
             attempt_count = attempt_count + 1,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'pending'
           AND expires_at > NOW()
         RETURNING *`,
        [id]
      );
      return result.rows[0] ?? null;
    },

    async reclaimStuck({ olderThanMs }) {
      const result = await pool.query(
        `UPDATE rewrite_runs
         SET status = 'pending', updated_at = NOW()
         WHERE status = 'processing'
           AND expires_at > NOW()
           AND updated_at < NOW() - ($1::text || ' milliseconds')::interval
         RETURNING id`,
        [String(olderThanMs)]
      );
      return result.rowCount ?? 0;
    },

    async deleteExpired() {
      const result = await pool.query(
        `DELETE FROM rewrite_runs WHERE expires_at <= NOW()`
      );
      return result.rowCount ?? 0;
    },

    async markCompleted(id, resultCipher) {
      await pool.query(
        `UPDATE rewrite_runs
         SET status = 'completed',
             result_ciphertext = $2,
             result_iv = $3,
             result_tag = $4,
             error_code = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [id, resultCipher.ciphertext, resultCipher.iv, resultCipher.tag]
      );
    },

    async markFailed(id, errorCode) {
      await pool.query(
        `UPDATE rewrite_runs
         SET status = 'failed',
             error_code = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [id, errorCode]
      );
    },

    async get(id) {
      const result = await pool.query(`SELECT * FROM rewrite_runs WHERE id = $1`, [id]);
      return result.rows[0] ?? null;
    }
  };
}
