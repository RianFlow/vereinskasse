CREATE TABLE `profile_recovery_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`slot` integer NOT NULL,
	`salt` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `profile_recovery_keys_profile_active_idx` ON `profile_recovery_keys` (`profile_id`,`used_at`,`slot`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `recovery_failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `recovery_locked_until` text;