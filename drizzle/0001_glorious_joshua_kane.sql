CREATE TABLE `sale_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text NOT NULL,
	`amount` real NOT NULL,
	`kind` text NOT NULL
);
