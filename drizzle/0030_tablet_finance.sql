CREATE TABLE `tablet_funds` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`label` text NOT NULL,
	`sponsor_id` text NOT NULL,
	`sponsor_name` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`budget_cents` integer DEFAULT 0 NOT NULL,
	`spent_cents` integer DEFAULT 0 NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tablet_funds_kind_check" CHECK("tablet_funds"."kind" IN ('cash','once')),
	CONSTRAINT "tablet_funds_state_check" CHECK("tablet_funds"."state" IN ('active','paused','closed')),
	CONSTRAINT "tablet_funds_budget_check" CHECK("tablet_funds"."budget_cents">=0 AND "tablet_funds"."spent_cents">=0 AND "tablet_funds"."refunded_cents">=0),
	CONSTRAINT "tablet_funds_balance_check" CHECK("tablet_funds"."kind"='once' OR "tablet_funds"."spent_cents"+"tablet_funds"."refunded_cents"<="tablet_funds"."budget_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tablet_funds_open_idx` ON `tablet_funds` (`profile_id`) WHERE "tablet_funds"."state" IN ('active','paused');--> statement-breakpoint
CREATE TABLE `tablet_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_hash` text NOT NULL,
	`undo_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`undone_at` text
);
--> statement-breakpoint
CREATE INDEX `tablet_operations_profile_idx` ON `tablet_operations` (`profile_id`,`created_at`);