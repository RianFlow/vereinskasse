CREATE TABLE `auth_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
