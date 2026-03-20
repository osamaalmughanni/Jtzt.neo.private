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

async function ensureUserContractScheduleSchema(db: AppDatabase) {
  const scheduleColumns = await db.all<{ name: string }>(
    "SELECT name FROM pragma_table_info('user_contract_schedule_days')",
  );
  if (scheduleColumns.length === 0) {
    await db.exec(`
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
    `);
  }

  const scheduleCount = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM user_contract_schedule_days");
  const contractCount = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM user_contracts");
  const expectedRows = (contractCount?.count ?? 0) * 7;
  if ((scheduleCount?.count ?? 0) >= expectedRows) {
    return;
  }

  await db.exec(`
    WITH RECURSIVE weekdays(day) AS (
      SELECT 1
      UNION ALL
      SELECT day + 1 FROM weekdays WHERE day < 7
    )
    INSERT INTO user_contract_schedule_days (
      contract_id,
      weekday,
      is_working_day,
      start_time,
      end_time,
      minutes
    )
    SELECT
      uc.id,
      weekdays.day,
      CASE
        WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN 1
        ELSE 0
      END,
      CASE
        WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN '09:00'
        ELSE NULL
      END,
      CASE
        WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN time('09:00', printf('+%d minutes', CAST(ROUND(uc.hours_per_week * 60.0 / 5.0) AS INTEGER)))
        ELSE NULL
      END,
      CASE
        WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN CAST(ROUND(uc.hours_per_week * 60.0 / 5.0) AS INTEGER)
        ELSE 0
      END
    FROM user_contracts uc
    CROSS JOIN weekdays
    WHERE NOT EXISTS (
      SELECT 1
      FROM user_contract_schedule_days existing
      WHERE existing.contract_id = uc.id
        AND existing.weekday = weekdays.day
    );
  `);
}

export async function ensureBootstrapState(db: AppDatabase, config: RuntimeConfig) {
  const key = getRuntimeKey(config);
  if (initializedKeys.has(key)) {
    return;
  }

  await ensureTimeEntriesSchema(db);
  await ensureUserContractScheduleSchema(db);

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

  const settingsColumns = await db.all<{ name: string }>(
    "SELECT name FROM pragma_table_info('company_settings')",
  );
  const settingsColumnNames = new Set(settingsColumns.map((column) => column.name));
  if (!settingsColumnNames.has("overtime_settings_json")) {
    await db.exec("ALTER TABLE company_settings ADD COLUMN overtime_settings_json TEXT NOT NULL DEFAULT '{}'");
  }

  const invitationCodeColumns = await db.all<{ name: string }>(
    "SELECT name FROM pragma_table_info('invitation_codes')",
  );
  if (invitationCodeColumns.length === 0) {
    await db.exec(`
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
    `);
  }

  initializedKeys.add(key);
}
