CREATE TABLE `rfid_pairing_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`hardware_id` text NOT NULL,
	`name` text NOT NULL,
	`code_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_id` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`approved_at` text,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rfid_pairing_requests_hardware_unique` ON `rfid_pairing_requests` (`hardware_id`);--> statement-breakpoint
CREATE INDEX `rfid_pairing_requests_status_expiry_idx` ON `rfid_pairing_requests` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `rfid_devices` ADD `hardware_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rfid_devices_hardware_id_unique` ON `rfid_devices` (`hardware_id`);