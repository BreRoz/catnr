UPDATE colonies SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE cats SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE people SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE ai_inputs SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE events SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE photos SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
UPDATE transactions SET owner_id='legacy:quarantine' WHERE owner_id IS NULL OR trim(owner_id)='' OR owner_id='local-owner';
--> statement-breakpoint
CREATE TRIGGER colonies_ownership_insert BEFORE INSERT ON colonies BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER colonies_ownership_update BEFORE UPDATE ON colonies BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER colonies_owner_immutable BEFORE UPDATE OF owner_id ON colonies WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
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
CREATE TRIGGER cats_owner_immutable BEFORE UPDATE OF owner_id ON cats WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER people_ownership_insert BEFORE INSERT ON people BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER people_ownership_update BEFORE UPDATE ON people BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER people_owner_immutable BEFORE UPDATE OF owner_id ON people WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_ownership_insert BEFORE INSERT ON ai_inputs BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_ownership_update BEFORE UPDATE ON ai_inputs BEGIN
 SELECT RAISE(ABORT,'Invalid ownership or relationship') WHERE NEW.owner_id IS NULL OR trim(NEW.owner_id)='' OR NEW.owner_id='local-owner' OR NEW.owner_id LIKE 'legacy:%';
END;
--> statement-breakpoint
CREATE TRIGGER ai_inputs_owner_immutable BEFORE UPDATE OF owner_id ON ai_inputs WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
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
CREATE TRIGGER events_owner_immutable BEFORE UPDATE OF owner_id ON events WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
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
CREATE TRIGGER photos_owner_immutable BEFORE UPDATE OF owner_id ON photos WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
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
CREATE TRIGGER transactions_owner_immutable BEFORE UPDATE OF owner_id ON transactions WHEN NEW.owner_id IS NOT OLD.owner_id BEGIN SELECT RAISE(ABORT,'Ownership is immutable'); END;
