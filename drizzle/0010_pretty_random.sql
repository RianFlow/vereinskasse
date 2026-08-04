CREATE TABLE `profile_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`color` text DEFAULT '#1d5b4c' NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_hash` text NOT NULL,
	`must_change_pin` integer DEFAULT false NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `account_transactions` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_rules` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `guest_accounts` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `rounds` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `profile_id` text DEFAULT 'darts' NOT NULL;
--> statement-breakpoint
INSERT INTO `profiles` (`id`,`name`,`short_name`,`color`,`pin_salt`,`pin_hash`,`must_change_pin`,`failed_attempts`,`active`,`created_at`,`updated_at`) VALUES ('darts','SV Barver Darts','Darts','#1d5b4c','7a7660fbafa3e00107ef1609dc6b19c3','6b66aa5e7bc6b477017b074f7ca5b694bfc0b287279f5011187b7d22b39537f1',1,0,1,'2026-07-21T00:00:00.000Z','2026-07-21T00:00:00.000Z');
--> statement-breakpoint
CREATE INDEX `products_profile_idx` ON `products` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `sales_profile_idx` ON `sales` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `accounts_profile_idx` ON `account_transactions` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `events_profile_idx` ON `events` (`profile_id`);
