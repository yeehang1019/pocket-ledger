CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`rule_id` text NOT NULL,
	`due` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occ_unique` ON `occurrences` (`owner`,`rule_id`,`due`);--> statement-breakpoint
CREATE INDEX `occ_owner_due` ON `occurrences` (`owner`,`due`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`start` text NOT NULL,
	`frequency` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`processed_through` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rule_owner` ON `rules` (`owner`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`rule_id` text,
	`occurrence` text,
	`deleted` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tx_owner_date` ON `transactions` (`owner`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `tx_occurrence` ON `transactions` (`owner`,`rule_id`,`occurrence`);