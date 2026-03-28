function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

export async function up({ context: db }) {
  if (!hasColumn(db, "company_settings", "weekend_days_json")) {
    db.exec("ALTER TABLE company_settings ADD COLUMN weekend_days_json TEXT NOT NULL DEFAULT '[6,7]'");
  }

  if (!hasColumn(db, "company_settings", "allow_records_on_weekends")) {
    db.exec("ALTER TABLE company_settings ADD COLUMN allow_records_on_weekends INTEGER NOT NULL DEFAULT 1");
  }
}
