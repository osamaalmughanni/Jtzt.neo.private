export async function up({ context: db }) {
  const columns = db.prepare("PRAGMA table_info(companies)").all();
  const hasAuthVersion = Array.isArray(columns) && columns.some((column) => column.name === "auth_version");
  if (hasAuthVersion) {
    return;
  }

  db.exec("ALTER TABLE companies ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0");
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
