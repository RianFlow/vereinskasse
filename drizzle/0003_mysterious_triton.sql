CREATE TABLE `account_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text NOT NULL,
	`sale_id` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`note` text NOT NULL,
	`operator_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reversals` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`reason` text NOT NULL,
	`amount` real NOT NULL,
	`operator_id` text NOT NULL,
	`operator_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`opened_by` text NOT NULL,
	`opened_by_name` text NOT NULL,
	`opened_at` text NOT NULL,
	`opening_cash` real NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`expected_cash` real,
	`counted_cash` real,
	`difference` real,
	`status` text NOT NULL
);
