PRAGMA foreign_keys = OFF;

ALTER TABLE time_entries RENAME TO time_entries_legacy;

CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave', 'time_off_in_lieu')),
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

INSERT INTO time_entries (
  id,
  company_id,
  user_id,
  entry_type,
  entry_date,
  end_date,
  start_time,
  end_time,
  notes,
  custom_field_values_json,
  created_at
)
SELECT
  id,
  company_id,
  user_id,
  entry_type,
  entry_date,
  end_date,
  start_time,
  end_time,
  notes,
  custom_field_values_json,
  created_at
FROM time_entries_legacy;

DROP TABLE time_entries_legacy;

CREATE INDEX idx_time_entries_company_user_day
ON time_entries (company_id, user_id, entry_date, end_date);

CREATE INDEX idx_time_entries_company_user_type_day
ON time_entries (company_id, user_id, entry_type, entry_date, end_date);

PRAGMA foreign_keys = ON;
