-- Stage 6: one authoritative schema.
-- Rebuilds every table with enforced foreign keys, mandatory ownership (owners), exact money
-- (integer minor units + currencies), explicit timestamps and the indexes the app relies on.
-- Existing rows are copied, never dropped; a legacy amount that is not a whole number of cents
-- aborts the whole migration instead of being rounded. The DB is rebuilt beside the old tables
-- (names ending __n) so no foreign key is ever violated, then swapped in.
DROP VIEW active_events;
--> statement-breakpoint
DROP VIEW active_transactions;
--> statement-breakpoint
DROP TRIGGER ai_inputs_owner_immutable;
--> statement-breakpoint
DROP TRIGGER ai_inputs_ownership_insert;
--> statement-breakpoint
DROP TRIGGER ai_inputs_ownership_update;
--> statement-breakpoint
DROP TRIGGER cats_owner_immutable;
--> statement-breakpoint
DROP TRIGGER cats_ownership_insert;
--> statement-breakpoint
DROP TRIGGER cats_ownership_update;
--> statement-breakpoint
DROP TRIGGER cats_revision_delete;
--> statement-breakpoint
DROP TRIGGER cats_revision_insert;
--> statement-breakpoint
DROP TRIGGER cats_revision_update;
--> statement-breakpoint
DROP TRIGGER cats_version;
--> statement-breakpoint
DROP TRIGGER clarification_answers_ownership;
--> statement-breakpoint
DROP TRIGGER clarification_resolutions_ownership;
--> statement-breakpoint
DROP TRIGGER clarifications_final_status;
--> statement-breakpoint
DROP TRIGGER clarifications_original_immutable;
--> statement-breakpoint
DROP TRIGGER clarifications_ownership;
--> statement-breakpoint
DROP TRIGGER colonies_owner_immutable;
--> statement-breakpoint
DROP TRIGGER colonies_ownership_insert;
--> statement-breakpoint
DROP TRIGGER colonies_ownership_update;
--> statement-breakpoint
DROP TRIGGER colonies_revision_delete;
--> statement-breakpoint
DROP TRIGGER colonies_revision_insert;
--> statement-breakpoint
DROP TRIGGER colonies_revision_update;
--> statement-breakpoint
DROP TRIGGER corrections_history_immutable;
--> statement-breakpoint
DROP TRIGGER corrections_no_delete;
--> statement-breakpoint
DROP TRIGGER corrections_ownership_insert;
--> statement-breakpoint
DROP TRIGGER corrections_revision_insert;
--> statement-breakpoint
DROP TRIGGER events_keep_corrected_history;
--> statement-breakpoint
DROP TRIGGER events_owner_immutable;
--> statement-breakpoint
DROP TRIGGER events_ownership_insert;
--> statement-breakpoint
DROP TRIGGER events_ownership_update;
--> statement-breakpoint
DROP TRIGGER events_revision_delete;
--> statement-breakpoint
DROP TRIGGER events_revision_insert;
--> statement-breakpoint
DROP TRIGGER events_revision_update;
--> statement-breakpoint
DROP TRIGGER events_superseded_content_frozen;
--> statement-breakpoint
DROP TRIGGER events_version;
--> statement-breakpoint
DROP TRIGGER people_owner_immutable;
--> statement-breakpoint
DROP TRIGGER people_ownership_insert;
--> statement-breakpoint
DROP TRIGGER people_ownership_update;
--> statement-breakpoint
DROP TRIGGER people_revision_delete;
--> statement-breakpoint
DROP TRIGGER people_revision_insert;
--> statement-breakpoint
DROP TRIGGER people_revision_update;
--> statement-breakpoint
DROP TRIGGER people_version;
--> statement-breakpoint
DROP TRIGGER photos_owner_immutable;
--> statement-breakpoint
DROP TRIGGER photos_ownership_insert;
--> statement-breakpoint
DROP TRIGGER photos_ownership_update;
--> statement-breakpoint
DROP TRIGGER photos_revision_delete;
--> statement-breakpoint
DROP TRIGGER photos_revision_insert;
--> statement-breakpoint
DROP TRIGGER photos_revision_update;
--> statement-breakpoint
DROP TRIGGER proposed_actions_immutable_plan;
--> statement-breakpoint
DROP TRIGGER proposed_actions_ownership;
--> statement-breakpoint
DROP TRIGGER transactions_keep_corrected_history;
--> statement-breakpoint
DROP TRIGGER transactions_owner_immutable;
--> statement-breakpoint
DROP TRIGGER transactions_ownership_insert;
--> statement-breakpoint
DROP TRIGGER transactions_ownership_update;
--> statement-breakpoint
DROP TRIGGER transactions_revision_delete;
--> statement-breakpoint
DROP TRIGGER transactions_revision_insert;
--> statement-breakpoint
DROP TRIGGER transactions_revision_update;
--> statement-breakpoint
DROP TRIGGER transactions_superseded_content_frozen;
--> statement-breakpoint
DROP TRIGGER transactions_version;
--> statement-breakpoint
DROP TRIGGER write_guard_check;
--> statement-breakpoint
CREATE TABLE owners (
 id TEXT PRIMARY KEY NOT NULL CHECK (trim(id) <> ''),
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE currencies (
 code TEXT PRIMARY KEY NOT NULL CHECK (length(code) = 3 AND code = upper(code)),
 minor_unit INTEGER NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
 name TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO currencies(code,minor_unit,name) VALUES ('USD',2,'US dollar'),('CAD',2,'Canadian dollar'),('EUR',2,'Euro'),('GBP',2,'Pound sterling'),('MXN',2,'Mexican peso'),('AUD',2,'Australian dollar');
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM colonies WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM people WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM ai_inputs WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM cats WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM events WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM photos WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM transactions WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM write_requests WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM rescue_revisions WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM write_guards WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM corrections WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM proposed_actions WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM proposal_executions WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM clarifications WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM clarification_answers WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO owners(id,status) SELECT DISTINCT owner_id, CASE WHEN owner_id LIKE 'legacy:%' THEN 'quarantined' ELSE 'active' END FROM clarification_resolutions WHERE owner_id IS NOT NULL AND trim(owner_id) <> '';
--> statement-breakpoint
CREATE TABLE money_migration_guard (ok INTEGER NOT NULL CONSTRAINT "legacy amount is not a whole number of cents" CHECK (ok = 1));
--> statement-breakpoint
INSERT INTO money_migration_guard(ok) SELECT 0 FROM transactions WHERE (amount IS NOT NULL AND abs(amount * 100 - round(amount * 100)) > 0.000001) OR (estimated_value IS NOT NULL AND abs(estimated_value * 100 - round(estimated_value * 100)) > 0.000001);
--> statement-breakpoint
INSERT INTO money_migration_guard(ok) SELECT 0 FROM transactions WHERE COALESCE(currency,'USD') NOT IN (SELECT code FROM currencies);
--> statement-breakpoint
DROP TABLE money_migration_guard;
--> statement-breakpoint
CREATE TABLE colonies__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 name TEXT NOT NULL CHECK (trim(name) <> ''),
 general_location TEXT,
 notes TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id)
);
--> statement-breakpoint
CREATE TABLE people__n (
 version INTEGER NOT NULL DEFAULT 0,
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 name TEXT NOT NULL CHECK (trim(name) <> ''),
 type TEXT CHECK (type IS NULL OR type IN ('donor','adopter','foster','volunteer','veterinarian','other')),
 general_location TEXT,
 contact TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id)
);
--> statement-breakpoint
CREATE TABLE ai_inputs__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 transcription TEXT NOT NULL,
 input_type TEXT NOT NULL CHECK (trim(input_type) <> ''),
 interpretation TEXT,
 confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
 clarification TEXT,
 correction TEXT,
 records_created TEXT,
 records_updated TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id)
);
--> statement-breakpoint
CREATE TABLE corrections__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
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
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 undone_at TEXT,
 undone_by TEXT,
 UNIQUE (id, owner_id),
 FOREIGN KEY (source_input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (reverts_id, owner_id) REFERENCES corrections__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE cats__n (
 version INTEGER NOT NULL DEFAULT 0,
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 name TEXT,
 sex TEXT CHECK (sex IS NULL OR sex IN ('male','female','unknown')),
 age_class TEXT CHECK (age_class IS NULL OR age_class IN ('kitten','juvenile','adult','senior','unknown')),
 appearance TEXT,
 distinguishing_characteristics TEXT,
 health_observations TEXT,
 reproductive_significance TEXT,
 origin_colony_id TEXT,
 current_status TEXT NOT NULL DEFAULT 'observed' CHECK (trim(current_status) <> ''),
 current_location TEXT,
 microchip_number TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id),
 FOREIGN KEY (origin_colony_id, owner_id) REFERENCES colonies__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE events__n (
 version INTEGER NOT NULL DEFAULT 0,
 superseded_at TEXT,
 superseded_by TEXT,
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 cat_id TEXT,
 event_type TEXT NOT NULL CHECK (trim(event_type) <> ''),
 occurred_at TEXT NOT NULL,
 location TEXT,
 person_id TEXT,
 notes TEXT,
 source_input_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id),
 FOREIGN KEY (cat_id, owner_id) REFERENCES cats__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (person_id, owner_id) REFERENCES people__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (source_input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (superseded_by, owner_id) REFERENCES corrections__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE photos__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 cat_id TEXT,
 event_id TEXT,
 storage_location TEXT NOT NULL CHECK (trim(storage_location) <> ''),
 taken_at TEXT NOT NULL,
 caption TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK (cat_id IS NOT NULL OR event_id IS NOT NULL),
 FOREIGN KEY (cat_id, owner_id) REFERENCES cats__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (event_id, owner_id) REFERENCES events__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE transactions__n (
 version INTEGER NOT NULL DEFAULT 0,
 superseded_at TEXT,
 superseded_by TEXT,
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 transaction_type TEXT NOT NULL CHECK (trim(transaction_type) <> ''),
 direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
 date TEXT NOT NULL,
 amount_minor INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor >= 0)),
 currency TEXT NOT NULL DEFAULT 'USD' REFERENCES currencies(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
 person_id TEXT,
 category TEXT,
 description TEXT NOT NULL,
 item TEXT,
 quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
 unit TEXT,
 estimated_value_minor INTEGER CHECK (estimated_value_minor IS NULL OR (typeof(estimated_value_minor) = 'integer' AND estimated_value_minor >= 0)),
 related_cat_id TEXT,
 related_event_id TEXT,
 related_colony_id TEXT,
 source_input_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE (id, owner_id),
 FOREIGN KEY (person_id, owner_id) REFERENCES people__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (related_cat_id, owner_id) REFERENCES cats__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (related_event_id, owner_id) REFERENCES events__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (related_colony_id, owner_id) REFERENCES colonies__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (source_input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (superseded_by, owner_id) REFERENCES corrections__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE write_requests__n (
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 response TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (owner_id, request_key)
);
--> statement-breakpoint
CREATE TABLE rescue_revisions__n (
 owner_id TEXT PRIMARY KEY NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE write_guards__n (
 owner_id TEXT PRIMARY KEY NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 expected_version INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE proposed_actions__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 input_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('record','correction')),
 plan TEXT NOT NULL,
 reasons TEXT NOT NULL,
 correction_target TEXT,
 photo_digest TEXT,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','executed','rejected')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 decided_at TEXT,
 decided_by TEXT,
 UNIQUE (id, owner_id),
 FOREIGN KEY (input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE proposal_executions__n (
 proposal_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 executed_at TEXT NOT NULL,
 FOREIGN KEY (proposal_id, owner_id) REFERENCES proposed_actions__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE clarifications__n (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
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
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','cancelled','expired','stale')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 decided_at TEXT,
 UNIQUE (id, owner_id),
 FOREIGN KEY (input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE clarification_answers__n (
 id TEXT PRIMARY KEY NOT NULL,
 clarification_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 input_id TEXT NOT NULL,
 question TEXT NOT NULL,
 answer TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK (outcome IN ('resolved','still_ambiguous')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY (clarification_id, owner_id) REFERENCES clarifications__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (input_id, owner_id) REFERENCES ai_inputs__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE clarification_resolutions__n (
 clarification_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 resolved_at TEXT NOT NULL,
 FOREIGN KEY (clarification_id, owner_id) REFERENCES clarifications__n(id, owner_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO colonies__n(id,owner_id,name,general_location,notes,status,created_at,updated_at) SELECT id,owner_id,name,general_location,notes,status,created_at,created_at FROM colonies;
--> statement-breakpoint
INSERT INTO people__n(version,id,owner_id,name,type,general_location,contact,created_at,updated_at) SELECT version,id,owner_id,name,type,general_location,contact,created_at,created_at FROM people;
--> statement-breakpoint
INSERT INTO ai_inputs__n(id,owner_id,transcription,input_type,interpretation,confidence,clarification,correction,records_created,records_updated,created_at) SELECT id,owner_id,transcription,input_type,interpretation,confidence,clarification,correction,records_created,records_updated,created_at FROM ai_inputs;
--> statement-breakpoint
INSERT INTO corrections__n(id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,status,made_by,actor_id,reason,source_input_id,original_snapshot,replacement_snapshot,cat_changes,relinked,created_at,undone_at,undone_by) SELECT id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,status,made_by,actor_id,reason,source_input_id,original_snapshot,replacement_snapshot,cat_changes,relinked,created_at,undone_at,undone_by FROM corrections;
--> statement-breakpoint
INSERT INTO cats__n(version,id,owner_id,name,sex,age_class,appearance,distinguishing_characteristics,health_observations,reproductive_significance,origin_colony_id,current_status,current_location,microchip_number,created_at,updated_at) SELECT version,id,owner_id,name,sex,age_class,appearance,distinguishing_characteristics,health_observations,reproductive_significance,origin_colony_id,current_status,current_location,microchip_number,created_at,updated_at FROM cats;
--> statement-breakpoint
INSERT INTO events__n(version,superseded_at,superseded_by,id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,source_input_id,created_at,updated_at) SELECT version,superseded_at,superseded_by,id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,source_input_id,created_at,created_at FROM events;
--> statement-breakpoint
INSERT INTO photos__n(id,owner_id,cat_id,event_id,storage_location,taken_at,caption,created_at) SELECT id,owner_id,cat_id,event_id,storage_location,taken_at,caption,taken_at FROM photos;
--> statement-breakpoint
INSERT INTO transactions__n(version,superseded_at,superseded_by,id,owner_id,transaction_type,direction,date,amount_minor,currency,person_id,category,description,item,quantity,unit,estimated_value_minor,related_cat_id,related_event_id,related_colony_id,source_input_id,created_at,updated_at) SELECT version,superseded_at,superseded_by,id,owner_id,transaction_type,direction,date,CASE WHEN amount IS NULL THEN NULL ELSE CAST(round(amount * 100) AS INTEGER) END,COALESCE(currency,'USD'),person_id,category,description,item,quantity,unit,CASE WHEN estimated_value IS NULL THEN NULL ELSE CAST(round(estimated_value * 100) AS INTEGER) END,related_cat_id,related_event_id,related_colony_id,source_input_id,created_at,created_at FROM transactions;
--> statement-breakpoint
INSERT INTO write_requests__n(owner_id,request_key,request_hash,response,created_at) SELECT owner_id,request_key,request_hash,response,created_at FROM write_requests;
--> statement-breakpoint
INSERT INTO rescue_revisions__n(owner_id,version) SELECT owner_id,version FROM rescue_revisions;
--> statement-breakpoint
INSERT INTO write_guards__n(owner_id,expected_version) SELECT owner_id,expected_version FROM write_guards;
--> statement-breakpoint
INSERT INTO proposed_actions__n(id,owner_id,input_id,kind,plan,reasons,correction_target,photo_digest,status,created_at,expires_at,decided_at,decided_by) SELECT id,owner_id,input_id,kind,plan,reasons,correction_target,photo_digest,status,created_at,expires_at,decided_at,decided_by FROM proposed_actions;
--> statement-breakpoint
INSERT INTO proposal_executions__n(proposal_id,owner_id,executed_at) SELECT proposal_id,owner_id,executed_at FROM proposal_executions;
--> statement-breakpoint
INSERT INTO clarifications__n(id,owner_id,input_id,session_id,mode,original_text,question,candidates,proposed_plan,context,photo_name,photo_data,attempts,status,created_at,updated_at,expires_at,decided_at) SELECT id,owner_id,input_id,session_id,mode,original_text,question,candidates,proposed_plan,context,photo_name,photo_data,attempts,status,created_at,updated_at,expires_at,decided_at FROM clarifications;
--> statement-breakpoint
INSERT INTO clarification_answers__n(id,clarification_id,owner_id,input_id,question,answer,outcome,created_at) SELECT id,clarification_id,owner_id,input_id,question,answer,outcome,created_at FROM clarification_answers;
--> statement-breakpoint
INSERT INTO clarification_resolutions__n(clarification_id,owner_id,resolved_at) SELECT clarification_id,owner_id,resolved_at FROM clarification_resolutions;
--> statement-breakpoint
DROP TABLE clarification_resolutions;
--> statement-breakpoint
DROP TABLE clarification_answers;
--> statement-breakpoint
DROP TABLE clarifications;
--> statement-breakpoint
DROP TABLE proposal_executions;
--> statement-breakpoint
DROP TABLE proposed_actions;
--> statement-breakpoint
DROP TABLE write_guards;
--> statement-breakpoint
DROP TABLE rescue_revisions;
--> statement-breakpoint
DROP TABLE write_requests;
--> statement-breakpoint
DROP TABLE transactions;
--> statement-breakpoint
DROP TABLE photos;
--> statement-breakpoint
DROP TABLE events;
--> statement-breakpoint
DROP TABLE cats;
--> statement-breakpoint
DROP TABLE corrections;
--> statement-breakpoint
DROP TABLE ai_inputs;
--> statement-breakpoint
DROP TABLE people;
--> statement-breakpoint
DROP TABLE colonies;
--> statement-breakpoint
ALTER TABLE colonies__n RENAME TO colonies;
--> statement-breakpoint
ALTER TABLE people__n RENAME TO people;
--> statement-breakpoint
ALTER TABLE ai_inputs__n RENAME TO ai_inputs;
--> statement-breakpoint
ALTER TABLE corrections__n RENAME TO corrections;
--> statement-breakpoint
ALTER TABLE cats__n RENAME TO cats;
--> statement-breakpoint
ALTER TABLE events__n RENAME TO events;
--> statement-breakpoint
ALTER TABLE photos__n RENAME TO photos;
--> statement-breakpoint
ALTER TABLE transactions__n RENAME TO transactions;
--> statement-breakpoint
ALTER TABLE write_requests__n RENAME TO write_requests;
--> statement-breakpoint
ALTER TABLE rescue_revisions__n RENAME TO rescue_revisions;
--> statement-breakpoint
ALTER TABLE write_guards__n RENAME TO write_guards;
--> statement-breakpoint
ALTER TABLE proposed_actions__n RENAME TO proposed_actions;
--> statement-breakpoint
ALTER TABLE proposal_executions__n RENAME TO proposal_executions;
--> statement-breakpoint
ALTER TABLE clarifications__n RENAME TO clarifications;
--> statement-breakpoint
ALTER TABLE clarification_answers__n RENAME TO clarification_answers;
--> statement-breakpoint
ALTER TABLE clarification_resolutions__n RENAME TO clarification_resolutions;
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_colonies_owner_name ON colonies(owner_id, lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_people_owner_name ON people(owner_id, lower(name));
--> statement-breakpoint
CREATE INDEX idx_ai_inputs_owner_created ON ai_inputs(owner_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_cats_owner_status ON cats(owner_id, current_status);
--> statement-breakpoint
CREATE INDEX idx_cats_owner_colony ON cats(owner_id, origin_colony_id) WHERE origin_colony_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_cats_owner_microchip ON cats(owner_id, microchip_number) WHERE microchip_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_events_owner_cat_date ON events(owner_id, cat_id, occurred_at);
--> statement-breakpoint
CREATE INDEX idx_events_owner_person ON events(owner_id, person_id) WHERE person_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_events_owner_input ON events(owner_id, source_input_id) WHERE source_input_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_events_owner_superseded_by ON events(owner_id, superseded_by) WHERE superseded_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_photos_owner_cat ON photos(owner_id, cat_id, taken_at) WHERE cat_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_photos_owner_event ON photos(owner_id, event_id) WHERE event_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_direction_date ON transactions(owner_id, direction, date);
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_person ON transactions(owner_id, person_id) WHERE person_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_cat ON transactions(owner_id, related_cat_id) WHERE related_cat_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_event ON transactions(owner_id, related_event_id) WHERE related_event_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_colony ON transactions(owner_id, related_colony_id) WHERE related_colony_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_input ON transactions(owner_id, source_input_id) WHERE source_input_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_transactions_owner_superseded_by ON transactions(owner_id, superseded_by) WHERE superseded_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_corrections_owner ON corrections(owner_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_corrections_original ON corrections(owner_id, original_id);
--> statement-breakpoint
CREATE INDEX idx_corrections_replacement ON corrections(owner_id, replacement_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_applied_correction_per_original ON corrections(owner_id, original_id) WHERE kind = 'correction' AND status = 'applied';
--> statement-breakpoint
CREATE INDEX idx_proposed_actions_owner ON proposed_actions(owner_id, status, created_at);
--> statement-breakpoint
CREATE INDEX idx_proposed_actions_input ON proposed_actions(owner_id, input_id);
--> statement-breakpoint
CREATE INDEX idx_clarifications_owner ON clarifications(owner_id, status, created_at);
--> statement-breakpoint
CREATE INDEX idx_clarifications_input ON clarifications(owner_id, input_id);
--> statement-breakpoint
CREATE INDEX idx_clarification_answers ON clarification_answers(clarification_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_clarification_answers_input ON clarification_answers(owner_id, input_id);
--> statement-breakpoint
CREATE TRIGGER ai_inputs_owner_immutable BEFORE UPDATE OF owner_id ON ai_inputs WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_ownership_insert BEFORE INSERT ON ai_inputs BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_ownership_update BEFORE UPDATE ON ai_inputs BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER cats_owner_immutable BEFORE UPDATE OF owner_id ON cats WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER cats_ownership_insert BEFORE INSERT ON cats BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.origin_colony_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.origin_colony_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER cats_ownership_update BEFORE UPDATE ON cats BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.origin_colony_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.origin_colony_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_delete AFTER DELETE ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_insert AFTER INSERT ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER cats_revision_update AFTER UPDATE ON cats BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER cats_version AFTER UPDATE ON cats WHEN NEW.version=OLD.version BEGIN UPDATE cats SET version=OLD.version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER clarification_answers_ownership BEFORE INSERT ON clarification_answers BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM clarifications WHERE id=NEW.clarification_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER clarification_resolutions_ownership BEFORE INSERT ON clarification_resolutions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM clarifications WHERE id=NEW.clarification_id AND owner_id=NEW.owner_id AND status='pending');
END;
--> statement-breakpoint
CREATE TRIGGER clarifications_final_status BEFORE UPDATE ON clarifications WHEN OLD.status<>'pending' AND NEW.status IS NOT OLD.status BEGIN
 SELECT RAISE(ABORT,'A finished clarification cannot be reopened');
END;
--> statement-breakpoint
CREATE TRIGGER clarifications_original_immutable BEFORE UPDATE ON clarifications WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.input_id IS NOT OLD.input_id OR NEW.original_text IS NOT OLD.original_text OR NEW.proposed_plan IS NOT OLD.proposed_plan OR NEW.candidates IS NOT OLD.candidates OR NEW.photo_data IS NOT OLD.photo_data OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at BEGIN
 SELECT RAISE(ABORT,'The original clarification cannot be edited');
END;
--> statement-breakpoint
CREATE TRIGGER clarifications_ownership BEFORE INSERT ON clarifications BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER colonies_owner_immutable BEFORE UPDATE OF owner_id ON colonies WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER colonies_ownership_insert BEFORE INSERT ON colonies BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER colonies_ownership_update BEFORE UPDATE ON colonies BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_delete AFTER DELETE ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_insert AFTER INSERT ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER colonies_revision_update AFTER UPDATE ON colonies BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER corrections_history_immutable BEFORE UPDATE ON corrections WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.record_type IS NOT OLD.record_type OR NEW.original_id IS NOT OLD.original_id OR NEW.replacement_id IS NOT OLD.replacement_id OR NEW.reverts_id IS NOT OLD.reverts_id OR NEW.made_by IS NOT OLD.made_by OR NEW.actor_id IS NOT OLD.actor_id OR NEW.reason IS NOT OLD.reason OR NEW.source_input_id IS NOT OLD.source_input_id OR NEW.original_snapshot IS NOT OLD.original_snapshot OR NEW.replacement_snapshot IS NOT OLD.replacement_snapshot OR NEW.cat_changes IS NOT OLD.cat_changes OR NEW.relinked IS NOT OLD.relinked OR NEW.created_at IS NOT OLD.created_at OR (OLD.status='undone' AND NEW.status IS NOT OLD.status) BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_no_delete BEFORE DELETE ON corrections BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_ownership_insert BEFORE INSERT ON corrections BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='event' AND (NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.original_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.replacement_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.record_type='transaction' AND (NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.original_id AND owner_id=NEW.owner_id) OR NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.replacement_id AND owner_id=NEW.owner_id));
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.reverts_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM corrections WHERE id=NEW.reverts_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER corrections_revision_insert AFTER INSERT ON corrections BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_keep_corrected_history BEFORE DELETE ON events WHEN EXISTS(SELECT 1 FROM corrections WHERE record_type='event' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER events_owner_immutable BEFORE UPDATE OF owner_id ON events WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER events_ownership_insert BEFORE INSERT ON events BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER events_ownership_update BEFORE UPDATE ON events BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER events_revision_delete AFTER DELETE ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_revision_insert AFTER INSERT ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_revision_update AFTER UPDATE ON events BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER events_superseded_content_frozen BEFORE UPDATE ON events WHEN OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT NULL AND (NEW.event_type IS NOT OLD.event_type OR NEW.occurred_at IS NOT OLD.occurred_at OR NEW.notes IS NOT OLD.notes OR NEW.location IS NOT OLD.location OR NEW.cat_id IS NOT OLD.cat_id OR NEW.person_id IS NOT OLD.person_id) BEGIN SELECT RAISE(ABORT,'Superseded records are frozen'); END;
--> statement-breakpoint
CREATE TRIGGER events_version AFTER UPDATE ON events WHEN NEW.version=OLD.version BEGIN UPDATE events SET version=OLD.version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER people_owner_immutable BEFORE UPDATE OF owner_id ON people WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER people_ownership_insert BEFORE INSERT ON people BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER people_ownership_update BEFORE UPDATE ON people BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER people_revision_delete AFTER DELETE ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_revision_insert AFTER INSERT ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_revision_update AFTER UPDATE ON people BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER people_version AFTER UPDATE ON people WHEN NEW.version=OLD.version BEGIN UPDATE people SET version=OLD.version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER photos_owner_immutable BEFORE UPDATE OF owner_id ON photos WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER photos_ownership_insert BEFORE INSERT ON photos BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER photos_ownership_update BEFORE UPDATE ON photos BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_delete AFTER DELETE ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_insert AFTER INSERT ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER photos_revision_update AFTER UPDATE ON photos BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER proposed_actions_immutable_plan BEFORE UPDATE ON proposed_actions WHEN NEW.plan IS NOT OLD.plan OR NEW.owner_id IS NOT OLD.owner_id OR NEW.reasons IS NOT OLD.reasons BEGIN
 SELECT RAISE(ABORT,'A proposed action cannot be edited');
END;
--> statement-breakpoint
CREATE TRIGGER proposed_actions_ownership BEFORE INSERT ON proposed_actions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER transactions_keep_corrected_history BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM corrections WHERE record_type='transaction' AND (original_id=OLD.id OR replacement_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Corrected records are preserved'); END;
--> statement-breakpoint
CREATE TRIGGER transactions_owner_immutable BEFORE UPDATE OF owner_id ON transactions WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER transactions_ownership_insert BEFORE INSERT ON transactions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.related_cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.related_event_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_colony_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.related_colony_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER transactions_ownership_update BEFORE UPDATE ON transactions BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_cat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cats WHERE id=NEW.related_cat_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.related_event_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.related_colony_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM colonies WHERE id=NEW.related_colony_id AND owner_id=NEW.owner_id);
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.source_input_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_inputs WHERE id=NEW.source_input_id AND owner_id=NEW.owner_id);
END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_delete AFTER DELETE ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_insert AFTER INSERT ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_revision_update AFTER UPDATE ON transactions BEGIN INSERT INTO rescue_revisions(owner_id,version) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET version=version+1; END;
--> statement-breakpoint
CREATE TRIGGER transactions_superseded_content_frozen BEFORE UPDATE ON transactions WHEN OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT NULL AND (NEW.amount_minor IS NOT OLD.amount_minor OR NEW.currency IS NOT OLD.currency OR NEW.estimated_value_minor IS NOT OLD.estimated_value_minor OR NEW.description IS NOT OLD.description OR NEW.direction IS NOT OLD.direction OR NEW.date IS NOT OLD.date OR NEW.item IS NOT OLD.item OR NEW.quantity IS NOT OLD.quantity) BEGIN SELECT RAISE(ABORT,'Superseded records are frozen'); END;
--> statement-breakpoint
CREATE TRIGGER transactions_version AFTER UPDATE ON transactions WHEN NEW.version=OLD.version BEGIN UPDATE transactions SET version=OLD.version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER write_guard_check BEFORE INSERT ON write_guards BEGIN SELECT RAISE(ABORT,'Concurrent edit') WHERE COALESCE((SELECT version FROM rescue_revisions WHERE owner_id=NEW.owner_id),0) != NEW.expected_version; END;
--> statement-breakpoint
CREATE TRIGGER colonies_register_owner BEFORE INSERT ON colonies WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER people_register_owner BEFORE INSERT ON people WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_register_owner BEFORE INSERT ON ai_inputs WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER cats_register_owner BEFORE INSERT ON cats WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER events_register_owner BEFORE INSERT ON events WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER photos_register_owner BEFORE INSERT ON photos WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER transactions_register_owner BEFORE INSERT ON transactions WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER write_requests_register_owner BEFORE INSERT ON write_requests WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER rescue_revisions_register_owner BEFORE INSERT ON rescue_revisions WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER write_guards_register_owner BEFORE INSERT ON write_guards WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER corrections_register_owner BEFORE INSERT ON corrections WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER proposed_actions_register_owner BEFORE INSERT ON proposed_actions WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER proposal_executions_register_owner BEFORE INSERT ON proposal_executions WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER clarifications_register_owner BEFORE INSERT ON clarifications WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER clarification_answers_register_owner BEFORE INSERT ON clarification_answers WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER clarification_resolutions_register_owner BEFORE INSERT ON clarification_resolutions WHEN NEW.owner_id IS NOT NULL AND trim(NEW.owner_id) <> '' AND NEW.owner_id <> 'local-owner' AND NEW.owner_id NOT LIKE 'legacy:%' BEGIN INSERT OR IGNORE INTO owners(id) VALUES (NEW.owner_id); END;
--> statement-breakpoint
CREATE TRIGGER write_requests_owner_immutable BEFORE UPDATE OF owner_id ON write_requests WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER write_guards_owner_immutable BEFORE UPDATE OF owner_id ON write_guards WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER rescue_revisions_owner_immutable BEFORE UPDATE OF owner_id ON rescue_revisions WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proposal_executions_owner_immutable BEFORE UPDATE OF owner_id ON proposal_executions WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER clarification_answers_owner_immutable BEFORE UPDATE OF owner_id ON clarification_answers WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER clarification_resolutions_owner_immutable BEFORE UPDATE OF owner_id ON clarification_resolutions WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER colonies_touch AFTER UPDATE ON colonies WHEN NEW.updated_at IS OLD.updated_at BEGIN UPDATE colonies SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER currencies_minor_unit_frozen BEFORE UPDATE OF minor_unit ON currencies WHEN NEW.minor_unit IS NOT OLD.minor_unit AND EXISTS (SELECT 1 FROM transactions WHERE currency = OLD.code) BEGIN SELECT RAISE(ABORT,'A currency in use cannot change its minor unit'); END;
--> statement-breakpoint
CREATE VIEW active_events AS SELECT * FROM events WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE VIEW active_transactions AS SELECT * FROM transactions WHERE superseded_at IS NULL;
