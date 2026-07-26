CREATE TABLE `rfid_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`uid` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rfid_cards_profile_uid_unique` ON `rfid_cards` (`profile_id`,`uid`);--> statement-breakpoint
CREATE INDEX `rfid_cards_profile_member_idx` ON `rfid_cards` (`profile_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `rfid_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rfid_devices_token_hash_unique` ON `rfid_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `rfid_devices_profile_active_idx` ON `rfid_devices` (`profile_id`,`active`);--> statement-breakpoint
CREATE TABLE `rfid_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`device_id` text NOT NULL,
	`uid` text NOT NULL,
	`card_type` text,
	`blocks` integer,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `rfid_scans_profile_pending_idx` ON `rfid_scans` (`profile_id`,`consumed_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `rfid_scans_device_uid_idx` ON `rfid_scans` (`device_id`,`uid`,`created_at`);