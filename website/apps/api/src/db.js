import pg from "pg";
import { SOCIAL_SCHEMA_SQL } from "./social/schema.js";

const { Pool } = pg;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rewrite_runs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  payload_tag TEXT NOT NULL,
  result_ciphertext TEXT,
  result_iv TEXT,
  result_tag TEXT,
  error_code TEXT,
  persona_version TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rewrite_runs_expires_at_idx ON rewrite_runs (expires_at);
CREATE INDEX IF NOT EXISTS rewrite_runs_status_updated_at_idx ON rewrite_runs (status, updated_at);

CREATE TABLE IF NOT EXISTS account_devices (
  device_distinct_id TEXT PRIMARY KEY,
  account_distinct_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
export function createPool(databaseUrl, poolOptions = {}) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required.");
  }
  return new Pool({ connectionString: databaseUrl, ...poolOptions });
}

export async function migrate(pool) {
  await pool.query(SCHEMA_SQL);
  await pool.query(SOCIAL_SCHEMA_SQL);
}

// PgBouncer transaction pooling doesn't reliably support session-level DDL
// behavior, so migrations run over the direct (non-pooled) connection when
// one's available, on a short-lived pool closed right after.
export async function migrateOverDirectConnection(databaseUrl, databaseUrlUnpooled) {
  const pool = createPool(databaseUrlUnpooled || databaseUrl, { max: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
