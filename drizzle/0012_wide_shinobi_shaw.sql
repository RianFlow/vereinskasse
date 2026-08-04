ALTER TABLE `products` ADD `is_offer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `counts_for_consumption` integer DEFAULT true NOT NULL;