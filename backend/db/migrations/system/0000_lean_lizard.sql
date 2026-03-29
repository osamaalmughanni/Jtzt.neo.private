CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_key_hash` text,
	`api_key_created_at` text,
	`tablet_code_value` text,
	`tablet_code_hash` text,
	`tablet_code_updated_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_name_lower` ON `companies` (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_api_key_hash` ON `companies` (`api_key_hash`) WHERE "companies"."api_key_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_tablet_code_hash` ON `companies` (`tablet_code_hash`) WHERE "companies"."tablet_code_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_tablet_code_value` ON `companies` (`tablet_code_value`) WHERE "companies"."tablet_code_value" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `developer_access_tokens` (
	`company_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`created_at` text NOT NULL,
	`rotated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_developer_access_tokens_token_hash` ON `developer_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `invitation_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`used_at` text,
	`used_by_company_id` text,
	FOREIGN KEY (`used_by_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_codes_code_unique` ON `invitation_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_invitation_codes_status` ON `invitation_codes` (`used_at`,`created_at`);