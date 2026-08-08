ALTER TABLE `rfid_devices` ADD `ble_session_id` text;--> statement-breakpoint
ALTER TABLE `rfid_devices` ADD `ble_session_counter` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rfid_devices` ADD `ble_session_expires_at` text;
