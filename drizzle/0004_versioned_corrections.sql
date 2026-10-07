ALTER TABLE events ADD COLUMN superseded_at TEXT;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN superseded_by TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN superseded_at TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN superseded_by TEXT;
--> statement-breakpoint
CREATE VIEW active_events AS SELECT * FROM events WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE VIEW active_transactions AS SELECT * FROM transactions WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE TABLE corrections (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('correction','undo')),
 record_type TEXT NOT NULL CHECK (record_type IN ('event','transaction')),
 original_id TEXT NOT NULL,
 replacement_id TEXT NOT NULL,
 reverts_id TEXT,
 status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone')),
 made_by TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 reason TEXT,
 source_input_id TEXT,
 original_snapshot TEXT NOT NULL,
 replacement_snapshot TEXT,
 cat_changes TEXT NOT NULL DEFAULT '[]',
 relinked TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL,
 undone_at TEXT,
 undone_by TEXT
);
--> statement-breakpoint
CREATE INDEX idx_corrections_owner ON corrections(owner_id,created_at);
--> statement-breakpoint
CREATE INDEX idx_corrections_original ON corrections(owner_id,original_id);
--> statement-breakpoint
CREATE INDEX idx_corrections_replacement ON corrections(owner_id,replacement_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_applied_correction_per_original ON corrections(owner_id,original_id) WHERE kind='correction' AND status='applied';
--> statement-breakpoint
CREATE TRIGGER corrections_ownership_insert BEFORE INSERT ON corrections BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='event' AND (NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.original_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.replacement_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='transaction' AND (NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.original_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.replacement_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.reverts_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM corrections WHERE id=NEW.reverts_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER corrections_history_immutable BEFORE UPDATE ON corrections WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.record_type IS NOT OLD.record_type OR NEW.original_id IS NOT OLD.original_id OR NEW.replacement_id IS NOT OLD.replacement_id OR NEW.reverts_id IS NOT OLD.reverts_id OR NEW.made_by IS NOT OLD.made_by OR NEW.actor_id IS NOT OLD.actor_id OR NEW.reason IS NOT OLD.reason OR NEW.source_input_id IS NOT OLD.source_input_id OR NEW.original_snapshot IS NOT OLD.original_snapshot OR NEW.replacement_snapshot IS NOT OLD.replacement_snapshot OR NEW.cat_changes IS NOT OLD.cat_changes OR NEW.relinked IS NOT OLD.relinked OR NEW.created_at IS NOT OLD.created_at OR (OLD.status='undone' AND NEW.status IS NOT OLD.status) BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_no_delete BEFORE DELETE ON corrections BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER events_keep_corrected_history BEFORE DELETE ON events WHEN EXISTS(SELECT 1 FROM corrections WHERE record_type='event' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER transactions_keep_corrected_history BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM corrections WHERE record_type='transaction' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER events_superseded_content_frozen BEFORE UPDATE ON events WHEN OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT NULL AND (NEW.event_type IS NOT OLD.event_type OR NEW.occurred_at IS NOT OLD.occurred_at OR NEW.notes IS NOT OLD.notes OR NEW.location IS NOT OLD.location OR NEW.cat_id IS NOT OLD.cat_id OR NEW.person_id IS NOT OLD.person_id) BEGIN SELECT RAISE(ABORT,'Superseded records are frozen'); END;
--> statement-breakpoint
CREATE TRIGGER transactions_superseded_content_frozen BEFORE UPDATE ON transactions WHEN OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT NULL AND (NEW.amount IS NOT OLD.amount OR NEW.description IS NOT OLD.description OR NEW.direction IS NOT OLD.direction OR NEW.date IS NOT OLD.date OR NEW.item IS NOT OLD.item OR NEW.quantity IS NOT OLD.quantity) BEGIN SELECT RAISE(ABORT,'Superseded records are frozen'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_revision_insert AFTER INSERT ON corrections BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
