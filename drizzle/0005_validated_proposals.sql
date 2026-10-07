CREATE TABLE proposed_actions (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 input_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('record','correction')),
 plan TEXT NOT NULL,
 reasons TEXT NOT NULL,
 correction_target TEXT,
 photo_digest TEXT,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','executed','rejected')),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 decided_at TEXT,
 decided_by TEXT,
 FOREIGN KEY (input_id) REFERENCES ai_inputs(id)
);
--> statement-breakpoint
CREATE INDEX idx_proposed_actions_owner ON proposed_actions(owner_id,status,created_at);
--> statement-breakpoint
CREATE TABLE proposal_executions (
 proposal_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 executed_at TEXT NOT NULL,
 FOREIGN KEY (proposal_id) REFERENCES proposed_actions(id)
);
--> statement-breakpoint
CREATE TRIGGER proposed_actions_ownership BEFORE INSERT ON proposed_actions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER proposed_actions_immutable_plan BEFORE UPDATE ON proposed_actions WHEN NEW.plan IS NOT OLD.plan OR NEW.owner_id IS NOT OLD.owner_id OR NEW.reasons IS NOT OLD.reasons BEGIN
 SELECT RAISE(ABORT,'A proposed action cannot be edited');
END;
