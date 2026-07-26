CREATE TABLE `rfid_write_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`device_id` text NOT NULL,
	`uid` text NOT NULL,
	`block` integer NOT NULL,
	`payload_hex` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`claimed_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `rfid_write_commands_device_status_idx` ON `rfid_write_commands` (`device_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `rfid_write_commands_profile_created_idx` ON `rfid_write_commands` (`profile_id`,`created_at`);