CREATE TABLE `calculations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sql_text` text NOT NULL,
	`output_mode` text DEFAULT 'both' NOT NULL,
	`chart_type` text DEFAULT 'bar' NOT NULL,
	`chart_category_column` text,
	`chart_value_column` text,
	`chart_series_column` text,
	`chart_config_json` text DEFAULT '{}' NOT NULL,
	`chart_stacked` integer DEFAULT 0 NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL,
	`builtin_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "calculations_output_mode_check" CHECK("calculations"."output_mode" IN ('table', 'chart', 'both')),
	CONSTRAINT "calculations_chart_type_check" CHECK("calculations"."chart_type" IN ('bar', 'line', 'area', 'pie'))
);
--> statement-breakpoint
CREATE TABLE `company_settings` (
	`currency` text DEFAULT 'EUR' NOT NULL,
	`locale` text DEFAULT 'de-AT' NOT NULL,
	`time_zone` text DEFAULT 'Europe/Vienna' NOT NULL,
	`date_time_format` text DEFAULT 'dd.MM.yyyy HH:mm' NOT NULL,
	`first_day_of_week` integer DEFAULT 1 NOT NULL,
	`weekend_days_json` text DEFAULT '[6,7]' NOT NULL,
	`edit_days_limit` integer DEFAULT 30 NOT NULL,
	`insert_days_limit` integer DEFAULT 30 NOT NULL,
	`allow_one_record_per_day` integer DEFAULT 0 NOT NULL,
	`allow_intersecting_records` integer DEFAULT 0 NOT NULL,
	`allow_records_on_holidays` integer DEFAULT 1 NOT NULL,
	`allow_records_on_weekends` integer DEFAULT 1 NOT NULL,
	`allow_future_records` integer DEFAULT 0 NOT NULL,
	`country` text DEFAULT 'AT' NOT NULL,
	`tablet_idle_timeout_seconds` integer DEFAULT 10 NOT NULL,
	`auto_break_after_minutes` integer DEFAULT 300 NOT NULL,
	`auto_break_duration_minutes` integer DEFAULT 30 NOT NULL,
	`projects_enabled` integer DEFAULT 0 NOT NULL,
	`tasks_enabled` integer DEFAULT 0 NOT NULL,
	`overtime_settings_json` text DEFAULT '{}' NOT NULL,
	`custom_fields_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`project_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `task_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_tasks_task` ON `project_tasks` (`task_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_users` (
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_users_user` ON `project_users` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`budget` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`allow_all_users` integer DEFAULT 1 NOT NULL,
	`allow_all_tasks` integer DEFAULT 1 NOT NULL,
	`custom_field_values_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_active` ON `projects` (`is_active`,`created_at`);--> statement-breakpoint
CREATE TABLE `public_holiday_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country_code` text NOT NULL,
	`year` integer NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_public_holiday_cache_country_year` ON `public_holiday_cache` (`country_code`,`year`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`custom_field_values_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_active` ON `tasks` (`is_active`,`created_at`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`entry_type` text DEFAULT 'work' NOT NULL,
	`entry_date` text NOT NULL,
	`end_date` text,
	`start_time` text NOT NULL,
	`end_time` text,
	`notes` text,
	`project_id` integer,
	`task_id` integer,
	`custom_field_values_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_entries_entry_type_check" CHECK("time_entries"."entry_type" IN ('work', 'vacation', 'sick_leave', 'time_off_in_lieu'))
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_user_day` ON `time_entries` (`user_id`,`entry_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_user_type_day` ON `time_entries` (`user_id`,`entry_type`,`entry_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `user_contract_schedule_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`block_order` integer DEFAULT 1 NOT NULL,
	`start_time` text,
	`end_time` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `user_contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_contract_schedule_blocks_weekday_check" CHECK("user_contract_schedule_blocks"."weekday" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE INDEX `idx_user_contract_schedule_blocks_contract` ON `user_contract_schedule_blocks` (`contract_id`,`weekday`,`block_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_contract_schedule_blocks_contract_weekday_order_unique` ON `user_contract_schedule_blocks` (`contract_id`,`weekday`,`block_order`);--> statement-breakpoint
CREATE TABLE `user_contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`hours_per_week` real NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`payment_per_hour` real NOT NULL,
	`annual_vacation_days` real DEFAULT 25 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_contracts_user` ON `user_contracts` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`full_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`pin_code` text DEFAULT '0000' NOT NULL,
	`email` text,
	`custom_field_values_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('employee', 'manager', 'admin'))
);
--> statement-breakpoint
CREATE INDEX `idx_users_name` ON `users` (`full_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_pin_code` ON `users` (`pin_code`) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE VIEW `custom_field_values` AS 
  SELECT
    'user' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM users, json_each(users.custom_field_values_json)
  UNION ALL
  SELECT
    'project' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM projects, json_each(projects.custom_field_values_json)
  UNION ALL
  SELECT
    'task' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM tasks, json_each(tasks.custom_field_values_json)
  UNION ALL
  SELECT
    'time_entry' AS entity_type,
    id AS entity_id,
    entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM time_entries, json_each(time_entries.custom_field_values_json)
;--> statement-breakpoint
CREATE VIEW `holidays` AS 
  SELECT
    public_holiday_cache.country_code,
    public_holiday_cache.year,
    CAST(json_extract(json_each.value, '$.date') AS TEXT) AS date,
    CAST(json_extract(json_each.value, '$.localName') AS TEXT) AS local_name,
    CAST(json_extract(json_each.value, '$.name') AS TEXT) AS name,
    CAST(json_extract(json_each.value, '$.countryCode') AS TEXT) AS country_code_from_payload
  FROM public_holiday_cache
  JOIN company_settings
    ON UPPER(COALESCE(company_settings.country, '')) = public_holiday_cache.country_code
  JOIN json_each(public_holiday_cache.payload_json)
  WHERE json_extract(json_each.value, '$.date') IS NOT NULL
;