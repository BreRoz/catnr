CREATE TABLE `cats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`sex` text,
	`age_class` text,
	`appearance` text,
	`distinguishing_characteristics` text,
	`health_observations` text,
	`reproductive_significance` text,
	`origin_colony_id` text,
	`current_status` text DEFAULT 'observed' NOT NULL,
	`current_location` text,
	`microchip_number` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`origin_colony_id`) REFERENCES `colonies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cats_origin_status` ON `cats` (`origin_colony_id`,`current_status`);--> statement-breakpoint
CREATE TABLE `colonies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`general_location` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`cat_id` text,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`location` text,
	`person_id` text,
	`notes` text,
	`source_input_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_input_id`) REFERENCES `ai_inputs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_cat_date` ON `events` (`cat_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ai_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`transcription` text NOT NULL,
	`input_type` text NOT NULL,
	`interpretation` text,
	`confidence` real,
	`clarification` text,
	`correction` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`general_location` text,
	`contact` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`cat_id` text,
	`event_id` text,
	`storage_location` text NOT NULL,
	`taken_at` text NOT NULL,
	`caption` text,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_type` text NOT NULL,
	`direction` text NOT NULL,
	`date` text NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'USD',
	`person_id` text,
	`category` text,
	`description` text NOT NULL,
	`item` text,
	`quantity` real,
	`unit` text,
	`estimated_value` real,
	`related_cat_id` text,
	`related_event_id` text,
	`related_colony_id` text,
	`source_input_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_colony_id`) REFERENCES `colonies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_input_id`) REFERENCES `ai_inputs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_direction_date` ON `transactions` (`direction`,`date`);