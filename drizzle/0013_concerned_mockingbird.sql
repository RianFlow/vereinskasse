CREATE INDEX `account_transactions_profile_member_created_idx` ON `account_transactions` (`profile_id`,`member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_transactions_sale_idx` ON `account_transactions` (`sale_id`);--> statement-breakpoint
CREATE INDEX `events_profile_status_starts_idx` ON `events` (`profile_id`,`status`,`starts_at`);--> statement-breakpoint
CREATE INDEX `guest_accounts_profile_parent_active_idx` ON `guest_accounts` (`profile_id`,`parent_id`,`active`);--> statement-breakpoint
CREATE INDEX `payments_profile_member_created_idx` ON `payments` (`profile_id`,`member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `products_profile_category_idx` ON `products` (`profile_id`,`category`);--> statement-breakpoint
CREATE INDEX `reversals_sale_idx` ON `reversals` (`sale_id`);--> statement-breakpoint
CREATE INDEX `round_claims_round_member_idx` ON `round_claims` (`round_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `sale_allocations_sale_member_idx` ON `sale_allocations` (`sale_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `sale_items_sale_consumption_idx` ON `sale_items` (`sale_id`,`counts_for_consumption`);--> statement-breakpoint
CREATE INDEX `sales_profile_time_idx` ON `sales` (`profile_id`,`time`);--> statement-breakpoint
CREATE INDEX `sales_profile_event_idx` ON `sales` (`profile_id`,`event_id`);