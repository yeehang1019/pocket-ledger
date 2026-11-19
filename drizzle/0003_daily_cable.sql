CREATE TABLE `trip_group_labels` (
	`owner` text NOT NULL,
	`group_id` text NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_group_label_key` ON `trip_group_labels` (`owner`,`group_id`);