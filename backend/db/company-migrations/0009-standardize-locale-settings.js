export async function up({ context: db }) {
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.exec(`
      UPDATE company_settings
         SET
           locale = CASE
             WHEN locale IS NULL OR TRIM(locale) = '' OR locale = 'en-GB' THEN 'de-AT'
             ELSE locale
           END,
           time_zone = CASE
             WHEN time_zone IS NULL OR TRIM(time_zone) = '' THEN 'Europe/Vienna'
             ELSE time_zone
           END,
           date_time_format = CASE
             WHEN date_time_format IS NULL
               OR TRIM(date_time_format) = ''
               OR date_time_format IN ('g', 'G', 'f', 'F', 'd', 'D', 't', 'T', 'm', 'M', 'y', 'Y', 'o', 'O', 's', 'u')
             THEN 'dd.MM.yyyy HH:mm'
             ELSE date_time_format
           END
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
