function hasObsoleteColumns(rows) {
  const obsolete = new Set([
    "encryption_enabled",
    "encryption_kdf_algorithm",
    "encryption_kdf_iterations",
    "encryption_kdf_salt",
    "encryption_key_verifier",
    "storage_mode",
    "storage_key_envelope_json",
  ]);
  return rows.some((row) => obsolete.has(row.name));
}

export async function up({ context: db }) {
  const columns = db.prepare("PRAGMA table_info(companies)").all();
  if (!Array.isArray(columns) || columns.length === 0 || !hasObsoleteColumns(columns)) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_key_hash TEXT,
      api_key_created_at TEXT,
      tablet_code_value TEXT,
      tablet_code_hash TEXT,
      tablet_code_updated_at TEXT,
      created_at TEXT NOT NULL
    );

    INSERT INTO companies_new (
      id,
      name,
      api_key_hash,
      api_key_created_at,
      tablet_code_value,
      tablet_code_hash,
      tablet_code_updated_at,
      created_at
    )
    SELECT
      id,
      name,
      api_key_hash,
      api_key_created_at,
      tablet_code_value,
      tablet_code_hash,
      tablet_code_updated_at,
      created_at
    FROM companies;

    DROP TABLE companies;
    ALTER TABLE companies_new RENAME TO companies;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_lower
    ON companies (lower(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_api_key_hash
    ON companies (api_key_hash)
    WHERE api_key_hash IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_hash
    ON companies (tablet_code_hash)
    WHERE tablet_code_hash IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_value
    ON companies (tablet_code_value)
    WHERE tablet_code_value IS NOT NULL;
  `);
  db.exec("PRAGMA foreign_keys = ON");
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
