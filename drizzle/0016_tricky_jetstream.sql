CREATE TABLE `random_reward_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text DEFAULT 'darts' NOT NULL,
	`name` text NOT NULL,
	`reward_type` text NOT NULL,
	`reward_value` real DEFAULT 0 NOT NULL,
	`total_wins` integer NOT NULL,
	`remaining_wins` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `random_reward_campaigns_profile_status_time_idx` ON `random_reward_campaigns` (`profile_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `random_reward_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text DEFAULT 'darts' NOT NULL,
	`campaign_id` text NOT NULL,
	`trigger_at` text NOT NULL,
	`claimed_at` text,
	`sale_id` text,
	`winner_name` text,
	`reward_amount` real,
	`reward_label` text
);
--> statement-breakpoint
CREATE INDEX `random_reward_slots_profile_campaign_trigger_idx` ON `random_reward_slots` (`profile_id`,`campaign_id`,`trigger_at`);--> statement-breakpoint
CREATE INDEX `random_reward_slots_sale_idx` ON `random_reward_slots` (`sale_id`);