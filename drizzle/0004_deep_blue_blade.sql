CREATE TABLE `discount_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`percent` real NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `products` ADD `member_price` real;