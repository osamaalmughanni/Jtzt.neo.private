function hasIndex(db, indexName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
  );
}

export async function up({ context: db }) {
  if (hasIndex(db, "idx_calculations_company_name")) {
    db.exec("DROP INDEX IF EXISTS idx_calculations_company_name");
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
