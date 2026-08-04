CREATE TABLE `member_lifecycle` (
	`member_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`left_at` text,
	`privacy_review_at` text,
	`retired_by` text,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_lifecycle_status_review_idx` ON `member_lifecycle` (`status`,`privacy_review_at`);--> statement-breakpoint
CREATE TABLE `monthly_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`month` text NOT NULL,
	`statement_number` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`checksum` text NOT NULL,
	`closed_by` text NOT NULL,
	`closed_by_name` text NOT NULL,
	`closed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_closures_profile_month_unique` ON `monthly_closures` (`profile_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_closures_statement_number_unique` ON `monthly_closures` (`statement_number`);--> statement-breakpoint
CREATE TABLE `restore_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`backup_key` text NOT NULL,
	`checksum` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_by_name` text NOT NULL,
	`approved_by` text,
	`approved_by_name` text,
	`preview_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`approved_at` text,
	`completed_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `restore_requests_profile_status_created_idx` ON `restore_requests` (`profile_id`,`status`,`created_at`);