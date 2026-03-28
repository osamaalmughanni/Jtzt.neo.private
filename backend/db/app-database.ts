export type DatabaseKind = "system" | "company";

function hardenCompanySchema(exec: (sql: string) => void) {
  exec(`
    DROP INDEX IF EXISTS idx_users_company_username;
    DROP INDEX IF EXISTS idx_users_company_pin_code;
    DROP INDEX IF EXISTS idx_users_username;
    DROP INDEX IF EXISTS idx_users_pin_code;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
    ON users (username)
    WHERE deleted_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin_code
    ON users (pin_code)
    WHERE deleted_at IS NULL;

    DROP INDEX IF EXISTS idx_public_holiday_cache_company_country_year;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_cache_country_year
    ON public_holiday_cache (country_code, year);
  `);
}

export function hardenSchemaForDatabase(database: { exec(sql: string): unknown }, kind: DatabaseKind) {
  if (kind !== "company") {
    return;
  }

  hardenCompanySchema((sql) => {
    database.exec(sql);
  });
}
