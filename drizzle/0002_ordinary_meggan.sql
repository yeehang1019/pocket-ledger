CREATE TABLE `trip_entries` (
	`owner` text NOT NULL,
	`group_id` text NOT NULL,
	`record_id` text NOT NULL,
	`member_id` text NOT NULL,
	`record_type` text NOT NULL,
	`group_type` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`currency` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`from_member` text DEFAULT '' NOT NULL,
	`to_member` text DEFAULT '' NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`seen_run` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_entry_key` ON `trip_entries` (`owner`,`record_type`,`group_id`,`record_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `trip_entry_owner_date` ON `trip_entries` (`owner`,`date`);--> statement-breakpoint
CREATE TABLE `trip_sync` (
	`owner` text PRIMARY KEY NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`run` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT 'full' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_completed` text DEFAULT '' NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL
);
