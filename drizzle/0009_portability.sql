-- Stage 10: portability and account controls.
-- data_exports      : a log of every download of personal data (what profile, when, how many rows).
-- deletion_requests : a pending, cancellable request to delete the whole account (24 hour wait).
-- deletion_in_progress : exists only inside the single atomic batch that deletes an account. The
--   history-protecting delete triggers below stand down while their owner's marker is present; nothing
--   else can delete audited history. Rows are never left behind: the batch removes its own marker.
-- deletion_receipts : proof that a deletion happened, with row counts only (no names, no email).
CREATE TABLE data_exports (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 profile TEXT NOT NULL CHECK (profile IN ('full','shareable')),
 format TEXT NOT NULL CHECK (format IN ('zip','json','csv')),
 counts TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX idx_data_exports_owner ON data_exports(owner_id, created_at);
--> statement-breakpoint
CREATE TABLE deletion_requests (
 owner_id TEXT PRIMARY KEY NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 requested_at TEXT NOT NULL,
 execute_after TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE deletion_in_progress (owner_id TEXT PRIMARY KEY NOT NULL);
--> statement-breakpoint
CREATE TABLE deletion_receipts (
 id TEXT PRIMARY KEY NOT NULL,
 completed_at TEXT NOT NULL,
 counts TEXT NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
-- Delete guards: identical to the earlier triggers except that they stand down for an account that is
-- being deleted as a whole.
DROP TRIGGER corrections_no_delete;
--> statement-breakpoint
CREATE TRIGGER corrections_no_delete BEFORE DELETE ON corrections WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
--> statement-breakpoint
DROP TRIGGER merges_no_delete;
--> statement-breakpoint
CREATE TRIGGER merges_no_delete BEFORE DELETE ON merges WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) BEGIN SELECT RAISE(ABORT,'Merge history is immutable'); END;
--> statement-breakpoint
DROP TRIGGER record_changes_no_delete;
--> statement-breakpoint
CREATE TRIGGER record_changes_no_delete BEFORE DELETE ON record_changes WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) BEGIN SELECT RAISE(ABORT,'Change history is immutable'); END;
--> statement-breakpoint
DROP TRIGGER duplicate_dismissals_no_delete;
--> statement-breakpoint
CREATE TRIGGER duplicate_dismissals_no_delete BEFORE DELETE ON duplicate_dismissals WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) BEGIN SELECT RAISE(ABORT,'Dismissals are immutable'); END;
--> statement-breakpoint
DROP TRIGGER events_keep_corrected_history;
--> statement-breakpoint
CREATE TRIGGER events_keep_corrected_history BEFORE DELETE ON events WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) AND EXISTS(SELECT 1 FROM corrections WHERE record_type='event' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
DROP TRIGGER transactions_keep_corrected_history;
--> statement-breakpoint
CREATE TRIGGER transactions_keep_corrected_history BEFORE DELETE ON transactions WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) AND EXISTS(SELECT 1 FROM corrections WHERE record_type='transaction' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
DROP TRIGGER cats_keep_audited_history;
--> statement-breakpoint
CREATE TRIGGER cats_keep_audited_history BEFORE DELETE ON cats WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) AND (EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='cat' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='cat' AND record_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
--> statement-breakpoint
DROP TRIGGER colonies_keep_audited_history;
--> statement-breakpoint
CREATE TRIGGER colonies_keep_audited_history BEFORE DELETE ON colonies WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) AND (EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='colony' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='colony' AND record_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
--> statement-breakpoint
DROP TRIGGER people_keep_audited_history;
--> statement-breakpoint
CREATE TRIGGER people_keep_audited_history BEFORE DELETE ON people WHEN NOT EXISTS(SELECT 1 FROM deletion_in_progress WHERE owner_id=OLD.owner_id) AND (EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='person' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='person' AND record_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
--> statement-breakpoint
-- Retention: a photo attached to a finished or expired clarification may be wiped (set to NULL) but never
-- replaced with different content; everything else about the original stays frozen.
DROP TRIGGER clarifications_original_immutable;
--> statement-breakpoint
CREATE TRIGGER clarifications_original_immutable BEFORE UPDATE ON clarifications WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.input_id IS NOT OLD.input_id OR NEW.original_text IS NOT OLD.original_text OR NEW.proposed_plan IS NOT OLD.proposed_plan OR NEW.candidates IS NOT OLD.candidates OR (NEW.photo_data IS NOT OLD.photo_data AND NEW.photo_data IS NOT NULL) OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at BEGIN
 SELECT RAISE(ABORT,'The original clarification cannot be edited');
END;
