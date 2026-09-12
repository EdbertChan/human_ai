export const SOCIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS social_campaign_settings (
  version INT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_campaign_settings_one_active_idx
  ON social_campaign_settings (active) WHERE active;

CREATE TABLE IF NOT EXISTS social_x_write_credentials (
  id UUID PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  x_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  access_token_tag TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  refresh_token_tag TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_refresh_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_x_write_credentials_one_active_idx
  ON social_x_write_credentials (active) WHERE active;

CREATE TABLE IF NOT EXISTS social_creators (
  x_user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('allowed', 'blocked', 'removed')),
  notes TEXT,
  since_id TEXT,
  last_scanned_at TIMESTAMPTZ,
  last_posted_at TIMESTAMPTZ,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 'removed' added after social_creators already had live rows. Widening this
-- CHECK constraint is additive (every existing 'allowed'/'blocked' row stays
-- valid) even though it needs an ALTER, unlike a destructive schema change.
ALTER TABLE social_creators DROP CONSTRAINT IF EXISTS social_creators_status_check;
ALTER TABLE social_creators ADD CONSTRAINT social_creators_status_check CHECK (status IN ('allowed', 'blocked', 'removed'));

CREATE TABLE IF NOT EXISTS social_source_posts (
  id UUID PRIMARY KEY,
  x_post_id TEXT NOT NULL UNIQUE,
  x_user_id TEXT NOT NULL REFERENCES social_creators (x_user_id),
  posted_at TIMESTAMPTZ NOT NULL,
  lang TEXT,
  state TEXT NOT NULL CHECK (state IN ('discovered', 'screening', 'rewrite_pending', 'queued', 'skipped', 'failed')),
  skip_reason TEXT,
  canonical_category TEXT,
  risk_class TEXT,
  diagnostics JSONB,
  text_ciphertext TEXT,
  text_iv TEXT,
  text_tag TEXT,
  text_purged_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE social_source_posts ADD COLUMN IF NOT EXISTS diagnostics JSONB;

CREATE INDEX IF NOT EXISTS social_source_posts_state_idx ON social_source_posts (state, discovered_at);

CREATE TABLE IF NOT EXISTS social_reply_candidates (
  id UUID PRIMARY KEY,
  source_post_id UUID NOT NULL UNIQUE REFERENCES social_source_posts (id),
  x_user_id TEXT NOT NULL REFERENCES social_creators (x_user_id),
  state TEXT NOT NULL CHECK (state IN (
    'queued', 'composer_opened', 'posted_pending_verification', 'posted',
    'deletion_required', 'deleted', 'expired', 'rejected', 'skipped', 'failed'
  )),
  state_reason TEXT,
  template_variant TEXT NOT NULL CHECK (template_variant IN ('A', 'B')),
  canonical_category TEXT NOT NULL,
  reply_ciphertext TEXT,
  reply_iv TEXT,
  reply_tag TEXT,
  posted_ciphertext TEXT,
  posted_iv TEXT,
  posted_tag TEXT,
  protocol_deviation BOOLEAN NOT NULL DEFAULT FALSE,
  reply_x_post_id TEXT UNIQUE,
  reply_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  composer_opened_at TIMESTAMPTZ,
  composer_opened_by TEXT,
  posted_at TIMESTAMPTZ,
  posted_pacific_date DATE,
  verified_by TEXT,
  closed_by TEXT,
  text_purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_reply_candidates_state_idx ON social_reply_candidates (state, expires_at);
CREATE INDEX IF NOT EXISTS social_reply_candidates_verified_day_idx
  ON social_reply_candidates (posted_pacific_date) WHERE posted_pacific_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_metrics_snapshots (
  id UUID PRIMARY KEY,
  candidate_id UUID NOT NULL REFERENCES social_reply_candidates (id),
  bucket_hours INT NOT NULL,
  impressions INT,
  likes INT,
  replies INT,
  reposts INT,
  quotes INT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, bucket_hours)
);

CREATE TABLE IF NOT EXISTS social_jobs (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'done', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  failure_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_jobs_runnable_idx ON social_jobs (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS social_event_outbox (
  id UUID PRIMARY KEY,
  destination TEXT NOT NULL CHECK (destination IN ('posthog', 'slack')),
  idempotency_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (destination, idempotency_key)
);

CREATE INDEX IF NOT EXISTS social_event_outbox_runnable_idx ON social_event_outbox (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS social_objections (
  id UUID PRIMARY KEY,
  candidate_id UUID REFERENCES social_reply_candidates (id),
  x_user_id TEXT NOT NULL,
  objection_class TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_objections_recent_idx ON social_objections (recorded_at);

CREATE TABLE IF NOT EXISTS social_runtime_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_x_spend (
  month TEXT PRIMARY KEY,
  reads INT NOT NULL DEFAULT 0,
  estimated_micros BIGINT NOT NULL DEFAULT 0,
  alerted_thresholds INT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  previous_value JSONB,
  next_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_audit_log_created_at_idx ON social_audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION social_audit_log_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'social_audit_log is append-only';
END;
$fn$ LANGUAGE plpgsql;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'social_audit_log_append_only_trigger'
      AND tgrelid = 'social_audit_log'::regclass
  ) THEN
    CREATE TRIGGER social_audit_log_append_only_trigger
      BEFORE UPDATE OR DELETE ON social_audit_log
      FOR EACH ROW EXECUTE FUNCTION social_audit_log_append_only();
  END IF;
END
$do$;
`;
