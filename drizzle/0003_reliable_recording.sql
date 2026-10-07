ALTER TABLE cats ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER cats_version AFTER UPDATE ON cats WHEN NEW.version=OLD.version BEGIN UPDATE cats SET version=OLD.version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
ALTER TABLE people ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER people_version AFTER UPDATE ON people WHEN NEW.version=OLD.version BEGIN UPDATE people SET version=OLD.version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER events_version AFTER UPDATE ON events WHEN NEW.version=OLD.version BEGIN UPDATE events SET version=OLD.version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER transactions_version AFTER UPDATE ON transactions WHEN NEW.version=OLD.version BEGIN UPDATE transactions SET version=OLD.version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TABLE rescue_revisions (owner_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE write_requests (owner_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_key));
--> statement-breakpoint
CREATE TABLE write_guards (owner_id TEXT PRIMARY KEY NOT NULL, expected_version INTEGER NOT NULL);
--> statement-breakpoint
CREATE TRIGGER write_guard_check BEFORE INSERT ON write_guards BEGIN SELECT RAISE(ABORT,'Concurrent edit') WHERE COALESCE((SELECT version FROM rescue_revisions WHERE owner_id=NEW.owner_id),0) != NEW.expected_version; END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_insert AFTER INSERT ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_update AFTER UPDATE ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_delete AFTER DELETE ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_revision_insert AFTER INSERT ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_revision_update AFTER UPDATE ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_revision_delete AFTER DELETE ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_insert AFTER INSERT ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_update AFTER UPDATE ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_delete AFTER DELETE ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_revision_insert AFTER INSERT ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_revision_update AFTER UPDATE ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_revision_delete AFTER DELETE ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_insert AFTER INSERT ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_update AFTER UPDATE ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_delete AFTER DELETE ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_insert AFTER INSERT ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_update AFTER UPDATE ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_delete AFTER DELETE ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
