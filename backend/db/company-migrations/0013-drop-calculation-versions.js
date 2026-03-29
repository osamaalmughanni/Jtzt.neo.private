function hasTable(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

export async function up({ context: db }) {
  if (hasTable(db, "calculation_versions")) {
    db.exec("DROP TABLE IF EXISTS calculation_versions");
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
