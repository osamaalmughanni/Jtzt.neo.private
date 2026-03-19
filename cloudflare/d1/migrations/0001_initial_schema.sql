PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  encryption_enabled INTEGER NOT NULL DEFAULT 0,
  encryption_kdf_algorithm TEXT,
  encryption_kdf_iterations INTEGER,
  encryption_kdf_salt TEXT,
  encryption_key_verifier TEXT,
  tablet_code_value TEXT,
  tablet_code_hash TEXT,
  tablet_code_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_hash
ON companies (tablet_code_hash)
WHERE tablet_code_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_value
ON companies (tablet_code_value)
WHERE tablet_code_value IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  pin_code TEXT NOT NULL DEFAULT '0000',
  email TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(company_id, username),
  UNIQUE(company_id, pin_code)
);

CREATE INDEX IF NOT EXISTS idx_users_company_name
ON users (company_id, full_name);

CREATE TABLE IF NOT EXISTS user_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  hours_per_week REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  payment_per_hour REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_contracts_company_user
ON user_contracts (company_id, user_id, start_date);

CREATE TABLE IF NOT EXISTS user_contract_schedule_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  is_working_day INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (contract_id) REFERENCES user_contracts(id) ON DELETE CASCADE,
  UNIQUE(contract_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_user_contract_schedule_days_contract
ON user_contract_schedule_days (contract_id, weekday);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave')),
  entry_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  notes TEXT,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_time_entries_company_user_day
ON time_entries (company_id, user_id, entry_date, end_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_company_user_type_day
ON time_entries (company_id, user_id, entry_type, entry_date, end_date);

CREATE TABLE IF NOT EXISTS company_settings (
  company_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'en-GB',
  time_zone TEXT NOT NULL DEFAULT 'Europe/Vienna',
  date_time_format TEXT NOT NULL DEFAULT 'g',
  first_day_of_week INTEGER NOT NULL DEFAULT 1,
  edit_days_limit INTEGER NOT NULL DEFAULT 30,
  insert_days_limit INTEGER NOT NULL DEFAULT 30,
  allow_one_record_per_day INTEGER NOT NULL DEFAULT 0,
  allow_intersecting_records INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'AT',
  tablet_idle_timeout_seconds INTEGER NOT NULL DEFAULT 10,
  auto_break_after_minutes INTEGER NOT NULL DEFAULT 300,
  auto_break_duration_minutes INTEGER NOT NULL DEFAULT 30,
  overtime_settings_json TEXT NOT NULL DEFAULT '{}',
  custom_fields_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public_holiday_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(company_id, country_code, year)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_company_active
ON projects (company_id, is_active, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_company_project
ON tasks (company_id, project_id, is_active, created_at);
