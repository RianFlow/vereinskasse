CREATE TABLE `rfid_display_states` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`customer_name` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`revision` text NOT NULL,
	`updated_at` text NOT NULL
);
