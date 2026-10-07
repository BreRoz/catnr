-- Stage 7: everyday record management. Archiving, voiding, merging and manual edits never delete rows;
-- they set a flag and leave an immutable audit entry.
ALTER TABLE cats ADD COLUMN archived_at TEXT;
--> statement-breakpoint
ALTER TABLE cats ADD COLUMN archive_reason TEXT;
--> statement-breakpoint
ALTER TABLE colonies ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE colonies ADD COLUMN latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
--> statement-breakpoint
ALTER TABLE colonies ADD COLUMN longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
--> statement-breakpoint
ALTER TABLE colonies ADD COLUMN archived_at TEXT;
--> statement-breakpoint
ALTER TABLE colonies ADD COLUMN archive_reason TEXT;
--> statement-breakpoint
ALTER TABLE people ADD COLUMN notes TEXT;
--> statement-breakpoint
ALTER TABLE people ADD COLUMN archived_at TEXT;
--> statement-breakpoint
ALTER TABLE people ADD COLUMN archive_reason TEXT;
--> statement-breakpoint
ALTER TABLE photos ADD COLUMN archived_at TEXT;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN voided_at TEXT;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN void_reason TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN voided_at TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN void_reason TEXT;
--> statement-breakpoint
-- Voided activity drops out of histories and totals exactly like superseded activity does.
DROP VIEW active_events;
--> statement-breakpoint
DROP VIEW active_transactions;
--> statement-breakpoint
CREATE VIEW active_events AS SELECT * FROM events WHERE superseded_at IS NULL AND voided_at IS NULL;
--> statement-breakpoint
CREATE VIEW active_transactions AS SELECT * FROM transactions WHERE superseded_at IS NULL AND voided_at IS NULL;
--> statement-breakpoint
-- A name only has to be unique among records that are still in use, so an archived or merged-away
-- record never blocks Ari from using its name again.
DROP INDEX uniq_colonies_owner_name;
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_colonies_owner_name ON colonies(owner_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
DROP INDEX uniq_people_owner_name;
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_people_owner_name ON people(owner_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
-- One trigger keeps version and updated_at current (replaces colonies_touch), as people_version does.
DROP TRIGGER colonies_touch;
--> statement-breakpoint
CREATE TRIGGER colonies_version AFTER UPDATE ON colonies WHEN NEW.version=OLD.version BEGIN UPDATE colonies SET version=OLD.version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE INDEX idx_cats_owner_updated ON cats(owner_id, updated_at);
--> statement-breakpoint
CREATE INDEX idx_people_owner_updated ON people(owner_id, updated_at);
--> statement-breakpoint
CREATE INDEX idx_colonies_owner_updated ON colonies(owner_id, updated_at);
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_date ON transactions(owner_id, date);
--> statement-breakpoint
CREATE TABLE merges (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 record_type TEXT NOT NULL CHECK (record_type IN ('cat','colony','person')),
 survivor_id TEXT NOT NULL,
 merged_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '{}',
 conflicts TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK (survivor_id <> merged_id),
 UNIQUE (id, owner_id),
 UNIQUE (owner_id, record_type, merged_id)
);
--> statement-breakpoint
CREATE TABLE record_changes (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 record_type TEXT NOT NULL CHECK (record_type IN ('cat','colony','person','event','transaction','photo')),
 record_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK (action IN ('create','update','archive','restore','void','unvoid','replace','merge_into','merged_from')),
 made_by TEXT NOT NULL DEFAULT 'user' CHECK (made_by IN ('user','assistant')),
 actor_id TEXT NOT NULL,
 reason TEXT,
 before_snapshot TEXT,
 after_snapshot TEXT,
 merge_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id),
 FOREIGN KEY (merge_id, owner_id) REFERENCES merges(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_record_changes_record ON record_changes(owner_id, record_type, record_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_record_changes_merge ON record_changes(owner_id, merge_id) WHERE merge_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_merges_survivor ON merges(owner_id, record_type, survivor_id);
--> statement-breakpoint
CREATE TRIGGER merges_immutable BEFORE UPDATE ON merges BEGIN SELECT RAISE(ABORT,'Merge history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER merges_no_delete BEFORE DELETE ON merges BEGIN SELECT RAISE(ABORT,'Merge history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER record_changes_immutable BEFORE UPDATE ON record_changes BEGIN SELECT RAISE(ABORT,'Change history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER record_changes_no_delete BEFORE DELETE ON record_changes BEGIN SELECT RAISE(ABORT,'Change history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER merges_ownership_insert BEFORE INSERT ON merges BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='cat' AND (NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.survivor_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.merged_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='colony' AND (NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.survivor_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.merged_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='person' AND (NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.survivor_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.merged_id AND owner_id=NEW.owner_id));
END;
--> statement-breakpoint
CREATE TRIGGER record_changes_ownership_insert BEFORE INSERT ON record_changes BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='cat' AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='colony' AND NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='person' AND NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='event' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='transaction' AND NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='photo' AND NOT EXISTS(SELECT 1 FROM photos WHERE id=NEW.record_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER merges_register_owner BEFORE INSERT ON merges WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER record_changes_register_owner BEFORE INSERT ON record_changes WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
-- "These are different cats/people/places": remembered so the pair is not suggested again.
CREATE TABLE duplicate_dismissals (
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 record_type TEXT NOT NULL CHECK (record_type IN ('cat','colony','person')),
 first_id TEXT NOT NULL,
 second_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (owner_id, record_type, first_id, second_id),
 CHECK (first_id < second_id)
);
--> statement-breakpoint
CREATE TRIGGER duplicate_dismissals_immutable BEFORE UPDATE ON duplicate_dismissals BEGIN SELECT RAISE(ABORT,'Dismissals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER duplicate_dismissals_no_delete BEFORE DELETE ON duplicate_dismissals BEGIN SELECT RAISE(ABORT,'Dismissals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER duplicate_dismissals_ownership_insert BEFORE INSERT ON duplicate_dismissals BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='cat' AND (NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.first_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.second_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='colony' AND (NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.first_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.second_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='person' AND (NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.first_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.second_id AND owner_id=NEW.owner_id));
END;
--> statement-breakpoint
CREATE TRIGGER duplicate_dismissals_register_owner BEFORE INSERT ON duplicate_dismissals WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
-- Records that have manual-change or merge history are preserved even against a direct delete.
CREATE TRIGGER cats_keep_audited_history BEFORE DELETE ON cats WHEN EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='cat' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='cat' AND record_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER colonies_keep_audited_history BEFORE DELETE ON colonies WHEN EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='colony' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='colony' AND record_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER people_keep_audited_history BEFORE DELETE ON people WHEN EXISTS(SELECT 1 FROM merges WHERE owner_id=OLD.owner_id AND record_type='person' AND (merged_id=OLD.id OR survivor_id=OLD.id)) OR EXISTS(SELECT 1 FROM record_changes WHERE owner_id=OLD.owner_id AND record_type='person' AND record_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Audited records are preserved'); END;
