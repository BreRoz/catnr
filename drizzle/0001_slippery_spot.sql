DROP INDEX `idx_cats_origin_status`;--> statement-breakpoint
ALTER TABLE `cats` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `idx_cats_owner_status` ON `cats` (`owner_id`,`current_status`);--> statement-breakpoint
DROP INDEX `idx_events_cat_date`;--> statement-breakpoint
ALTER TABLE `events` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `idx_events_owner_cat_date` ON `events` (`owner_id`,`cat_id`,`occurred_at`);--> statement-breakpoint
DROP INDEX `idx_transactions_direction_date`;--> statement-breakpoint
ALTER TABLE `transactions` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `idx_transactions_owner_direction_date` ON `transactions` (`owner_id`,`direction`,`date`);--> statement-breakpoint
ALTER TABLE `colonies` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `ai_inputs` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `ai_inputs` ADD `records_created` text;--> statement-breakpoint
ALTER TABLE `ai_inputs` ADD `records_updated` text;--> statement-breakpoint
ALTER TABLE `people` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `owner_id` text;