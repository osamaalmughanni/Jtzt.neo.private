function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

export async function up({ context: db }) {
  if (!hasColumn(db, "users", "deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
  }

  if (!hasColumn(db, "projects", "budget")) {
    db.exec("ALTER TABLE projects ADD COLUMN budget REAL NOT NULL DEFAULT 0");
  }

  if (!hasColumn(db, "projects", "allow_all_users")) {
    db.exec("ALTER TABLE projects ADD COLUMN allow_all_users INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn(db, "projects", "allow_all_tasks")) {
    db.exec("ALTER TABLE projects ADD COLUMN allow_all_tasks INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn(db, "company_settings", "projects_enabled")) {
    db.exec("ALTER TABLE company_settings ADD COLUMN projects_enabled INTEGER NOT NULL DEFAULT 0");
  }

  if (!hasColumn(db, "company_settings", "tasks_enabled")) {
    db.exec("ALTER TABLE company_settings ADD COLUMN tasks_enabled INTEGER NOT NULL DEFAULT 0");
  }

  if (!hasColumn(db, "time_entries", "project_id")) {
    db.exec("ALTER TABLE time_entries ADD COLUMN project_id INTEGER");
  }

  if (!hasColumn(db, "time_entries", "task_id")) {
    db.exec("ALTER TABLE time_entries ADD COLUMN task_id INTEGER");
  }

  db.exec(`UPDATE projects
    SET allow_all_users = CASE
      WHEN EXISTS (
        SELECT 1 FROM project_users pu WHERE pu.project_id = projects.id
      ) THEN 0
      ELSE 1
    END`);

  db.exec(`UPDATE projects
    SET allow_all_tasks = CASE
      WHEN EXISTS (
        SELECT 1 FROM project_tasks pt WHERE pt.project_id = projects.id
      ) THEN 0
      ELSE 1
    END`);
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
