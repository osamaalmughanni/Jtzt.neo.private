function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function dropCompanyIdIndexes(db) {
  const rows = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND sql IS NOT NULL
      AND sql LIKE '%company_id%'
  `).all();

  for (const row of rows) {
    if (!row.name || row.name.startsWith("sqlite_")) {
      continue;
    }

    db.exec(`DROP INDEX IF EXISTS ${row.name}`);
  }
}

export async function up({ context: db }) {
  const tables = [
    "company_settings",
    "users",
    "user_contracts",
    "user_contract_schedule_blocks",
    "time_entries",
    "public_holiday_cache",
    "projects",
    "tasks",
    "project_users",
    "project_tasks",
    "calculations",
    "calculation_versions",
  ];

  const tablesWithCompanyId = tables.filter((table) => hasColumn(db, table, "company_id"));
  if (tablesWithCompanyId.length === 0) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  dropCompanyIdIndexes(db);

  for (const tableName of tablesWithCompanyId) {
    db.exec(`ALTER TABLE ${tableName} DROP COLUMN company_id`);
  }

  db.exec("PRAGMA foreign_keys = ON");
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
