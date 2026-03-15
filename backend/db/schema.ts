export const systemSchema = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  encryption_enabled INTEGER NOT NULL DEFAULT 0,
  encryption_kdf_algorithm TEXT,
  encryption_kdf_iterations INTEGER,
  encryption_kdf_salt TEXT,
  encryption_key_verifier TEXT,
  database_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const companySchema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  hours_per_week REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  payment_per_hour REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave')),
  entry_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  notes TEXT,
  sick_leave_attachment_name TEXT,
  sick_leave_attachment_mime_type TEXT,
  sick_leave_attachment_data_url TEXT,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_day
ON time_entries (user_id, entry_date, end_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_type_day
ON time_entries (user_id, entry_type, entry_date, end_date);

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'en-GB',
  date_time_format TEXT NOT NULL DEFAULT 'g',
  first_day_of_week INTEGER NOT NULL DEFAULT 1,
  edit_days_limit INTEGER NOT NULL DEFAULT 30,
  insert_days_limit INTEGER NOT NULL DEFAULT 30,
  country TEXT NOT NULL DEFAULT 'AT',
  custom_fields_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public_holiday_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(country_code, year)
);
`;
