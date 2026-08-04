CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`code` text NOT NULL,
	`initials` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_code_unique` ON `members` (`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price` real NOT NULL,
	`icon` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`total` real NOT NULL,
	`items` integer NOT NULL,
	`time` text NOT NULL,
	`member` text NOT NULL,
	`member_id` text NOT NULL,
	`method` text NOT NULL,
	`cart_json` text NOT NULL,
	`backup_key` text
);
