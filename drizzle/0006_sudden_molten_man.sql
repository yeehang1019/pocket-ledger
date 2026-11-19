CREATE TABLE `pocket_commitments` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`currency` text NOT NULL,
	`source_key` text DEFAULT '' NOT NULL,
	`source_signature` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`mutation` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commitment_key` ON `pocket_commitments` (`owner`,`id`);--> statement-breakpoint
CREATE INDEX `commitment_owner` ON `pocket_commitments` (`owner`);