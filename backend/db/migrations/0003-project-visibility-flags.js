export async function up({ context: db }) {
  const hasColumn = (tableName, columnName) => {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
  };

  if (!hasColumn("projects", "allow_all_users")) {
    db.exec("ALTER TABLE projects ADD COLUMN allow_all_users INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn("projects", "allow_all_tasks")) {
    db.exec("ALTER TABLE projects ADD COLUMN allow_all_tasks INTEGER NOT NULL DEFAULT 1");
  }

  db.exec(`
    UPDATE projects
    SET allow_all_users = CASE
      WHEN EXISTS (
        SELECT 1
        FROM project_users pu
        WHERE pu.project_id = projects.id
      ) THEN 0
      ELSE 1
    END
  `);

  db.exec(`
    UPDATE projects
    SET allow_all_tasks = CASE
      WHEN EXISTS (
        SELECT 1
        FROM project_tasks pt
        WHERE pt.project_id = projects.id
      ) THEN 0
      ELSE 1
    END
  `);
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
