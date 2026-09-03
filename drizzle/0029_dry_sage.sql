CREATE TABLE `configuration_state` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation` text DEFAULT '' NOT NULL
);
