CREATE TABLE `budgets` (
	`owner` text NOT NULL,
	`month` text NOT NULL,
	`currency` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_scope` ON `budgets` (`owner`,`month`,`currency`,`category`);