import bcrypt from "bcryptjs";
import type { AppDatabase } from "./types";
import type { RuntimeConfig } from "./types";

const initializedKeys = new Set<string>();
const legacyTimeEntryColumns = [
  "sick_leave_attachment_name",
  "sick_leave_attachment_mime_type",
  "sick_leave_attachment_data_url",
];

function getRuntimeKey(config: RuntimeConfig) {
  return `${config.runtime}:${config.nodeSqlitePath}:${config.appEnv}`;
}

async function ensureTimeEntriesSchema(db: AppDatabase) {
  const timeEntryColumns = await db.all<{ name: string }>(
    "SELECT name FROM pragma_table_info('time_entries')",
  );
  const timeEntryColumnNames = new Set(timeEntryColumns.map((column) => column.name));
  const hasLegacyColumns = legacyTimeEntryColumns.some((column) => timeEntryColumnNames.has(column));
  if (!hasLegacyColumns) {
    return;
  }

  await db.exec(`
    ALTER TABLE time_entries RENAME TO time_entries_legacy;

    CREATE TABLE time_entries (
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

    CREATE INDEX IF NOT EXISTS idx_time_entries_company_user_day
    ON time_entries (company_id, user_id, entry_date, end_date);

    CREATE INDEX IF NOT EXISTS idx_time_entries_company_user_type_day
    ON time_entries (company_id, user_id, entry_type, entry_date, end_date);
  `);
}

export async function ensureBootstrapState(db: AppDatabase, config: RuntimeConfig) {
  const key = getRuntimeKey(config);
  if (initializedKeys.has(key)) {
    return;
  }

  await ensureTimeEntriesSchema(db);

  const companyColumns = await db.all<{ name: string }>(
    "SELECT name FROM pragma_table_info('companies')",
  );
  const companyColumnNames = new Set(companyColumns.map((column) => column.name));
  if (!companyColumnNames.has("api_key_hash")) {
    await db.exec("ALTER TABLE companies ADD COLUMN api_key_hash TEXT");
  }
  if (!companyColumnNames.has("api_key_created_at")) {
    await db.exec("ALTER TABLE companies ADD COLUMN api_key_created_at TEXT");
  }

  const row = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM admins");
  if (!row || row.count === 0) {
    await db.run("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)", [
      config.adminBootstrapUsername,
      bcrypt.hashSync(config.adminBootstrapPassword, 10),
      new Date().toISOString()
    ]);
  }

  initializedKeys.add(key);
}
