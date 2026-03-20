export type DatabaseKind = "system" | "company";

function hardenCompanySchema(exec: (sql: string) => void) {
  exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_username
    ON users (company_id, username);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_pin_code
    ON users (company_id, pin_code);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_cache_company_country_year
    ON public_holiday_cache (company_id, country_code, year);
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
