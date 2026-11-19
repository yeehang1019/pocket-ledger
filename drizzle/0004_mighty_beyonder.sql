CREATE TABLE `pocket_accounts` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`currency` text NOT NULL,
	`statement_day` integer NOT NULL,
	`due_day` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pocket_account_key` ON `pocket_accounts` (`owner`,`id`);--> statement-breakpoint
CREATE TABLE `pocket_bills` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`consumption_date` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`paid_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`parent_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pocket_bill_key` ON `pocket_bills` (`owner`,`id`);--> statement-breakpoint
CREATE INDEX `pocket_bill_owner_parent` ON `pocket_bills` (`owner`,`parent_id`);--> statement-breakpoint
CREATE INDEX `pocket_bill_owner_date` ON `pocket_bills` (`owner`,`consumption_date`);--> statement-breakpoint
CREATE TABLE `pocket_categories` (
	`owner` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pocket_category_key` ON `pocket_categories` (`owner`,`name`);--> statement-breakpoint
CREATE TABLE `pocket_goals` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`currency` text NOT NULL,
	`target` integer NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pocket_goal_key` ON `pocket_goals` (`owner`,`id`);--> statement-breakpoint
CREATE TABLE `pocket_templates` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`currency` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pocket_template_key` ON `pocket_templates` (`owner`,`id`);--> statement-breakpoint
CREATE TABLE `range_budgets` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`currency` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `range_budget_key` ON `range_budgets` (`owner`,`id`);