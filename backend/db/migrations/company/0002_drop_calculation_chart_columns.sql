DROP VIEW IF EXISTS `custom_field_values`;
--> statement-breakpoint
CREATE VIEW `custom_field_values` AS 
  SELECT
    'user' AS entity_type,
    users.id AS entity_id,
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
  FROM users
  JOIN json_each(users.custom_field_values_json)
  UNION ALL
  SELECT
    'project' AS entity_type,
    projects.id AS entity_id,
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
  FROM projects
  JOIN json_each(projects.custom_field_values_json)
  UNION ALL
  SELECT
    'task' AS entity_type,
    tasks.id AS entity_id,
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
  FROM tasks
  JOIN json_each(tasks.custom_field_values_json)
  UNION ALL
  SELECT
    'time_entry' AS entity_type,
    time_entries.id AS entity_id,
    time_entries.entry_type AS entry_type,
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
  FROM time_entries
  JOIN json_each(time_entries.custom_field_values_json);
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_config_json`;
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_type`;
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_category_column`;
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_value_column`;
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_series_column`;
--> statement-breakpoint
ALTER TABLE `calculations` DROP COLUMN `chart_stacked`;
