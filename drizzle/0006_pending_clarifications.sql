CREATE TABLE clarifications (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 input_id TEXT NOT NULL,
 session_id TEXT,
 mode TEXT NOT NULL,
 original_text TEXT NOT NULL,
 question TEXT NOT NULL,
 candidates TEXT NOT NULL DEFAULT '[]',
 proposed_plan TEXT NOT NULL,
 context TEXT,
 photo_name TEXT,
 photo_data TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','cancelled','expired','stale')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 decided_at TEXT,
 FOREIGN KEY (input_id) REFERENCES ai_inputs(id)
);
--> statement-breakpoint
CREATE INDEX idx_clarifications_owner ON clarifications(owner_id,status,created_at);
--> statement-breakpoint
CREATE TABLE clarification_answers (
 id TEXT PRIMARY KEY NOT NULL,
 clarification_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 input_id TEXT NOT NULL,
 question TEXT NOT NULL,
 answer TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK (outcome IN ('resolved','still_ambiguous')),
 created_at TEXT NOT NULL,
 FOREIGN KEY (clarification_id) REFERENCES clarifications(id),
 FOREIGN KEY (input_id) REFERENCES ai_inputs(id)
);
--> statement-breakpoint
CREATE INDEX idx_clarification_answers ON clarification_answers(clarification_id,created_at);
--> statement-breakpoint
CREATE TABLE clarification_resolutions (
 clarification_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 resolved_at TEXT NOT NULL,
 FOREIGN KEY (clarification_id) REFERENCES clarifications(id)
);
--> statement-breakpoint
CREATE TRIGGER clarifications_ownership BEFORE INSERT ON clarifications BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER clarification_answers_ownership BEFORE INSERT ON clarification_answers BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM clarifications WHERE id=NEW.clarification_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER clarification_resolutions_ownership BEFORE INSERT ON clarification_resolutions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM clarifications WHERE id=NEW.clarification_id AND owner_id=NEW.owner_id AND status='pending');
END;
--> statement-breakpoint
CREATE TRIGGER clarifications_original_immutable BEFORE UPDATE ON clarifications WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.input_id IS NOT OLD.input_id OR NEW.original_text IS NOT OLD.original_text OR NEW.proposed_plan IS NOT OLD.proposed_plan OR NEW.candidates IS NOT OLD.candidates OR NEW.photo_data IS NOT OLD.photo_data OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at BEGIN
 SELECT RAISE(ABORT,'The original clarification cannot be edited');
END;
--> statement-breakpoint
CREATE TRIGGER clarifications_final_status BEFORE UPDATE ON clarifications WHEN OLD.status<>'pending' AND NEW.status IS NOT OLD.status BEGIN
 SELECT RAISE(ABORT,'A finished clarification cannot be reopened');
END;
