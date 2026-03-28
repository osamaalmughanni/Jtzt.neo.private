function hasColumn(rows, columnName) {
  return rows.some((row) => row.name === columnName);
}

export async function up({ context: db }) {
  const columns = db.prepare("PRAGMA table_info(companies)").all();
  if (!Array.isArray(columns) || columns.length === 0) {
    return;
  }

  if (hasColumn(columns, "auth_version")) {
    return;
  }

  db.exec("ALTER TABLE companies ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0");
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
