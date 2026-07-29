ALTER TABLE `guest_accounts` ADD `visit_date` text;--> statement-breakpoint
CREATE INDEX `guest_accounts_profile_visit_idx` ON `guest_accounts` (`profile_id`,`visit_date`);