export async function up({ context: db }) {
  const hasColumn = (tableName, columnName) => {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
  };

  if (!hasColumn("projects", "budget")) {
    db.exec("ALTER TABLE projects ADD COLUMN budget REAL NOT NULL DEFAULT 0");
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
