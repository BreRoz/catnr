-- Stage 11: production operations (additive only: nothing existing is changed).
-- ops_events : a small operational log (errors, AI calls, rejected uploads, limit hits, job runs).
--   It holds NO rescue content and no email address: owner_hash is a one-way fingerprint, detail is
--   scrubbed text. It is deliberately not tied to owners, so account deletion never depends on it, and
--   the daily clean-up removes rows after 90 days. The AI usage limits are counted from it.
-- ops_flags  : emergency switches. A missing row means the feature is on; a row with enabled=0 turns
--   it off immediately, with no deploy (see docs/RUNBOOK.md).
-- Rolling this back is safe: dropping both tables loses only operational history; the app treats a
-- missing flag table as "everything on" only after the code is also rolled back (see docs/RUNBOOK.md).
CREATE TABLE ops_events (
 id TEXT PRIMARY KEY NOT NULL,
 at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 kind TEXT NOT NULL CHECK (kind IN ('api_error','db_error','ai_call','ai_failure','ai_invalid','upload_rejected','auth_failure','limit_hit','retry_replay','slow_request','job_ok','job_failure')),
 owner_hash TEXT,
 route TEXT,
 status INTEGER,
 duration_ms INTEGER,
 detail TEXT CHECK (detail IS NULL OR length(detail) <= 300)
);
--> statement-breakpoint
CREATE INDEX idx_ops_events_kind_at ON ops_events(kind, at);
--> statement-breakpoint
CREATE INDEX idx_ops_events_owner_kind_at ON ops_events(owner_hash, kind, at);
--> statement-breakpoint
CREATE TABLE ops_flags (
 name TEXT PRIMARY KEY NOT NULL CHECK (name IN ('ai','photo_uploads','imports')),
 enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
 reason TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
