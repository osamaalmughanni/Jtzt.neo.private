function tableExists(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

function getForeignKeyTargets(db, tableName) {
  if (!tableExists(db, tableName)) {
    return [];
  }
  const rows = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
  return rows.map((row) => row.table);
}

function readTasks(db, tableName) {
  if (!tableExists(db, tableName)) {
    return [];
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasProjectId = columns.some((column) => column.name === "project_id");
  return db.prepare(
    `SELECT
       id,
       title,
       is_active,
       created_at,
       ${hasProjectId ? "project_id" : "NULL AS project_id"}
     FROM ${tableName}`
  ).all();
}

function readProjectTaskRows(db) {
  if (!tableExists(db, "project_tasks")) {
    return [];
  }
  return db.prepare(
    `SELECT project_id, task_id, created_at
     FROM project_tasks`
  ).all();
}

function mergeTaskRows(primaryRows, secondaryRows) {
  const merged = new Map();
  for (const row of primaryRows) {
    merged.set(row.id, row);
  }
  for (const row of secondaryRows) {
    const existing = merged.get(row.id);
    if (!existing) {
      merged.set(row.id, row);
      continue;
    }
    merged.set(row.id, {
      id: row.id,
      title: row.title || existing.title,
      is_active: row.is_active,
      created_at: row.created_at || existing.created_at,
      project_id: row.project_id ?? existing.project_id,
    });
  }
  return Array.from(merged.values());
}

export async function up({ context: db }) {
  const taskColumns = tableExists(db, "tasks")
    ? db.prepare("PRAGMA table_info(tasks)").all()
    : [];
  const legacyTasksTableExists = tableExists(db, "tasks_legacy");
  const projectTasksTableExists = tableExists(db, "project_tasks");
  const projectTasksForeignKeyTargets = getForeignKeyTargets(db, "project_tasks");
  const needsRepair =
    legacyTasksTableExists ||
    taskColumns.some((column) => column.name === "project_id") ||
    projectTasksForeignKeyTargets.includes("tasks_legacy") ||
    (!projectTasksTableExists && (legacyTasksTableExists || taskColumns.some((column) => column.name === "project_id")));

  if (!needsRepair) {
    return;
  }

  const taskRows = legacyTasksTableExists
    ? mergeTaskRows(readTasks(db, "tasks_legacy"), readTasks(db, "tasks"))
    : readTasks(db, "tasks");
  const existingProjectTaskRows = readProjectTaskRows(db);
  const validProjectIds = new Set((db.prepare("SELECT id FROM projects").all()).map((row) => row.id));
  const validTaskIds = new Set(taskRows.map((row) => row.id));
  const assignmentKeySet = new Set();
  const assignmentRows = [];

  for (const row of taskRows) {
    if (row.project_id && validProjectIds.has(row.project_id)) {
      const key = `${row.project_id}:${row.id}`;
      if (!assignmentKeySet.has(key)) {
        assignmentKeySet.add(key);
        assignmentRows.push({ projectId: row.project_id, taskId: row.id, createdAt: row.created_at });
      }
    }
  }

  for (const row of existingProjectTaskRows) {
    if (!validProjectIds.has(row.project_id) || !validTaskIds.has(row.task_id)) {
      continue;
    }
    const key = `${row.project_id}:${row.task_id}`;
    if (assignmentKeySet.has(key)) {
      continue;
    }
    assignmentKeySet.add(key);
    assignmentRows.push({ projectId: row.project_id, taskId: row.task_id, createdAt: row.created_at });
  }

  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    db.exec("DROP TABLE IF EXISTS project_tasks");
    db.exec("DROP TABLE IF EXISTS tasks");
    db.exec("DROP TABLE IF EXISTS tasks_legacy");
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE project_tasks (
        project_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    for (const row of taskRows) {
      db.prepare("INSERT INTO tasks (id, title, is_active, created_at) VALUES (?, ?, ?, ?)").run(
        row.id,
        row.title,
        row.is_active,
        row.created_at
      );
    }

    for (const row of assignmentRows) {
      db.prepare("INSERT OR IGNORE INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)").run(
        row.projectId,
        row.taskId,
        row.createdAt
      );
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks (is_active, created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_project_tasks_task ON project_tasks (task_id, project_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_project_users_user ON project_users (user_id, project_id)");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw error;
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
