DROP INDEX `round_claims_round_member_idx`;--> statement-breakpoint
ALTER TABLE `round_claims` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
CREATE INDEX `round_claims_profile_round_member_idx` ON `round_claims` (`profile_id`,`round_id`,`member_id`);--> statement-breakpoint
DROP INDEX `sale_allocations_sale_member_idx`;--> statement-breakpoint
ALTER TABLE `sale_allocations` ADD `profile_id` text DEFAULT 'darts' NOT NULL;--> statement-breakpoint
CREATE INDEX `sale_allocations_profile_sale_member_idx` ON `sale_allocations` (`profile_id`,`sale_id`,`member_id`);