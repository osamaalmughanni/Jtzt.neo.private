export async function up({ context: db }) {
  db.exec("ALTER TABLE company_settings ADD COLUMN weekend_days_json TEXT NOT NULL DEFAULT '[6,7]'");
  db.exec("ALTER TABLE company_settings ADD COLUMN allow_records_on_weekends INTEGER NOT NULL DEFAULT 1");
}
