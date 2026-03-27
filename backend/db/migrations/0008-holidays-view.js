export async function up({ context: db }) {
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.exec("DROP VIEW IF EXISTS holidays");
    db.exec(`
      CREATE VIEW holidays AS
        SELECT
          public_holiday_cache.company_id,
          public_holiday_cache.country_code,
          public_holiday_cache.year,
          CAST(json_extract(json_each.value, '$.date') AS TEXT) AS date,
          CAST(json_extract(json_each.value, '$.localName') AS TEXT) AS local_name,
          CAST(json_extract(json_each.value, '$.name') AS TEXT) AS name,
          CAST(json_extract(json_each.value, '$.countryCode') AS TEXT) AS country_code_from_payload
        FROM public_holiday_cache
        JOIN company_settings
          ON company_settings.company_id = public_holiday_cache.company_id
         AND UPPER(COALESCE(company_settings.country, '')) = public_holiday_cache.country_code
        JOIN json_each(public_holiday_cache.payload_json)
        WHERE json_extract(json_each.value, '$.date') IS NOT NULL
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
