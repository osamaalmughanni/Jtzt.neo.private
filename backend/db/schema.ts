export const systemSchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT,
  api_key_created_at TEXT,
  tablet_code_value TEXT,
  tablet_code_hash TEXT,
  tablet_code_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_lower
ON companies (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_api_key_hash
ON companies (api_key_hash)
WHERE api_key_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_hash
ON companies (tablet_code_hash)
WHERE tablet_code_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_value
ON companies (tablet_code_value)
WHERE tablet_code_value IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by_company_id TEXT,
  FOREIGN KEY (used_by_company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_status
ON invitation_codes (used_at, created_at DESC);

CREATE TABLE IF NOT EXISTS developer_access_tokens (
  company_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_developer_access_tokens_token_hash
ON developer_access_tokens (token_hash);
`;

export const companySchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS company_settings (
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'de-AT',
  time_zone TEXT NOT NULL DEFAULT 'Europe/Vienna',
  date_time_format TEXT NOT NULL DEFAULT 'dd.MM.yyyy HH:mm',
  first_day_of_week INTEGER NOT NULL DEFAULT 1,
  weekend_days_json TEXT NOT NULL DEFAULT '[6,7]',
  edit_days_limit INTEGER NOT NULL DEFAULT 30,
  insert_days_limit INTEGER NOT NULL DEFAULT 30,
  allow_one_record_per_day INTEGER NOT NULL DEFAULT 0,
  allow_intersecting_records INTEGER NOT NULL DEFAULT 0,
  allow_records_on_holidays INTEGER NOT NULL DEFAULT 1,
  allow_records_on_weekends INTEGER NOT NULL DEFAULT 1,
  allow_future_records INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'AT',
  tablet_idle_timeout_seconds INTEGER NOT NULL DEFAULT 10,
  auto_break_after_minutes INTEGER NOT NULL DEFAULT 300,
  auto_break_duration_minutes INTEGER NOT NULL DEFAULT 30,
  projects_enabled INTEGER NOT NULL DEFAULT 0,
  tasks_enabled INTEGER NOT NULL DEFAULT 0,
  overtime_settings_json TEXT NOT NULL DEFAULT '{}',
  custom_fields_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  pin_code TEXT NOT NULL DEFAULT '0000',
  email TEXT,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_name
ON users (full_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
ON users (username)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin_code
ON users (pin_code)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  hours_per_week REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  payment_per_hour REAL NOT NULL,
  annual_vacation_days REAL NOT NULL DEFAULT 25,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_contracts_user
ON user_contracts (user_id, start_date);

CREATE TABLE IF NOT EXISTS user_contract_schedule_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  block_order INTEGER NOT NULL DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (contract_id) REFERENCES user_contracts(id) ON DELETE CASCADE,
  UNIQUE(contract_id, weekday, block_order)
);

CREATE INDEX IF NOT EXISTS idx_user_contract_schedule_blocks_contract
ON user_contract_schedule_blocks (contract_id, weekday, block_order);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave', 'time_off_in_lieu')),
  entry_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  notes TEXT,
  project_id INTEGER,
  task_id INTEGER,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_day
ON time_entries (user_id, entry_date, end_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_type_day
ON time_entries (user_id, entry_type, entry_date, end_date);

CREATE TABLE IF NOT EXISTS public_holiday_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_cache_country_year
ON public_holiday_cache (country_code, year);

CREATE VIEW IF NOT EXISTS holidays AS
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
  WHERE json_extract(json_each.value, '$.date') IS NOT NULL;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  budget REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  allow_all_users INTEGER NOT NULL DEFAULT 1,
  allow_all_tasks INTEGER NOT NULL DEFAULT 1,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_active
ON projects (is_active, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_active
ON tasks (is_active, created_at);

CREATE TABLE IF NOT EXISTS project_users (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_users_user
ON project_users (user_id, project_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  project_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_task
ON project_tasks (task_id, project_id);

CREATE VIEW IF NOT EXISTS custom_field_values AS
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
  FROM time_entries, json_each(time_entries.custom_field_values_json);

CREATE TABLE IF NOT EXISTS calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  sql_text TEXT NOT NULL,
  output_mode TEXT NOT NULL DEFAULT 'both' CHECK(output_mode IN ('table', 'chart', 'both')),
  chart_type TEXT NOT NULL DEFAULT 'bar' CHECK(chart_type IN ('bar', 'line', 'area', 'pie')),
  chart_category_column TEXT,
  chart_value_column TEXT,
  chart_series_column TEXT,
  chart_config_json TEXT NOT NULL DEFAULT '{}',
  chart_stacked INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  builtin_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
