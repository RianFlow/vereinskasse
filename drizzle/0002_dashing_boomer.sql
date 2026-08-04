CREATE TABLE `round_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`claimed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`sponsor_id` text NOT NULL,
	`sponsor_name` text NOT NULL,
	`label` text NOT NULL,
	`total_units` integer NOT NULL,
	`remaining` integer NOT NULL,
	`max_per_member` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
