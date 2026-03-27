import { Umzug, type UmzugStorage } from "umzug";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DatabaseKind } from "./app-database";

const MIGRATION_TABLE = "jtzt_migrations";

type SqliteContext = Database.Database;

class SqliteMigrationStorage implements UmzugStorage<SqliteContext> {
  constructor(private readonly db: SqliteContext) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        name TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL
      )
    `);
  }

  async logMigration({ name }: { name: string }) {
    this.db.prepare(`INSERT OR REPLACE INTO ${MIGRATION_TABLE} (name, executed_at) VALUES (?, ?)`).run(name, new Date().toISOString());
  }

  async unlogMigration({ name }: { name: string }) {
    this.db.prepare(`DELETE FROM ${MIGRATION_TABLE} WHERE name = ?`).run(name);
  }

  async executed() {
    const rows = this.db.prepare(`SELECT name FROM ${MIGRATION_TABLE} ORDER BY executed_at ASC, name ASC`).all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }
}

function ensureColumn(db: SqliteContext, tableName: string, columnName: string, alterSql: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(alterSql);
  }
}

function tableExists(db: SqliteContext, tableName: string) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

function getForeignKeyTargets(db: SqliteContext, tableName: string) {
  if (!tableExists(db, tableName)) {
    return [] as string[];
  }
  const rows = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{ table: string }>;
  return rows.map((row) => row.table);
}

function readTasks(db: SqliteContext, tableName: "tasks" | "tasks_legacy") {
  if (!tableExists(db, tableName)) {
    return [] as Array<{
      id: number;
      company_id: string;
      title: string;
      is_active: number;
      created_at: string;
      project_id: number | null;
    }>;
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const hasProjectId = columns.some((column) => column.name === "project_id");
  return db.prepare(
    `SELECT
       id,
       company_id,
       title,
       is_active,
       created_at,
       ${hasProjectId ? "project_id" : "NULL AS project_id"}
     FROM ${tableName}`
  ).all() as Array<{
    id: number;
    company_id: string;
    title: string;
    is_active: number;
    created_at: string;
    project_id: number | null;
  }>;
}

function readProjectTaskRows(db: SqliteContext) {
  if (!tableExists(db, "project_tasks")) {
    return [] as Array<{ project_id: number; task_id: number; created_at: string }>;
  }
  return db.prepare(
    `SELECT project_id, task_id, created_at
     FROM project_tasks`
  ).all() as Array<{ project_id: number; task_id: number; created_at: string }>;
}

function mergeTaskRows(
  primaryRows: Array<{
    id: number;
    company_id: string;
    title: string;
    is_active: number;
    created_at: string;
    project_id: number | null;
  }>,
  secondaryRows: Array<{
    id: number;
    company_id: string;
    title: string;
    is_active: number;
    created_at: string;
    project_id: number | null;
  }>
) {
  const merged = new Map<number, typeof primaryRows[number]>();
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
      company_id: row.company_id || existing.company_id,
      title: row.title || existing.title,
      is_active: row.is_active,
      created_at: row.created_at || existing.created_at,
      project_id: row.project_id ?? existing.project_id,
    });
  }
  return Array.from(merged.values());
}

async function loadFileBasedMigrations(db: SqliteContext) {
  const migrationsDir = path.join(process.cwd(), "backend", "db", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return [] as Array<{
      name: string;
      up: () => Promise<void>;
      down: () => Promise<void>;
    }>;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));

  const migrations: Array<{
    name: string;
    up: () => Promise<void>;
    down: () => Promise<void>;
  }> = [];

  for (const file of files) {
    const moduleUrl = pathToFileURL(path.join(migrationsDir, file)).href;
    const migrationModule = await import(moduleUrl) as {
      up: (context: { context: SqliteContext }) => Promise<void>;
      down?: (context: { context: SqliteContext }) => Promise<void>;
    };
    migrations.push({
      name: file.replace(/\.js$/, ""),
      up: async () => {
        await migrationModule.up({ context: db });
      },
      down: async () => {
        if (migrationModule.down) {
          await migrationModule.down({ context: db });
          return;
        }
        throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
      },
    });
  }

  return migrations;
}

async function migrateCompanyWorkflow(db: SqliteContext) {
  ensureColumn(db, "users", "deleted_at", "ALTER TABLE users ADD COLUMN deleted_at TEXT");
  ensureColumn(db, "projects", "allow_all_users", "ALTER TABLE projects ADD COLUMN allow_all_users INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "projects", "allow_all_tasks", "ALTER TABLE projects ADD COLUMN allow_all_tasks INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "company_settings", "projects_enabled", "ALTER TABLE company_settings ADD COLUMN projects_enabled INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "company_settings", "tasks_enabled", "ALTER TABLE company_settings ADD COLUMN tasks_enabled INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "time_entries", "project_id", "ALTER TABLE time_entries ADD COLUMN project_id INTEGER");
  ensureColumn(db, "time_entries", "task_id", "ALTER TABLE time_entries ADD COLUMN task_id INTEGER");

  if (tableExists(db, "project_users")) {
    db.exec(`
      UPDATE projects
      SET allow_all_users = CASE
        WHEN EXISTS (
          SELECT 1 FROM project_users pu WHERE pu.project_id = projects.id
        ) THEN 0
        ELSE 1
      END
    `);
  }
  if (tableExists(db, "project_tasks")) {
    db.exec(`
      UPDATE projects
      SET allow_all_tasks = CASE
        WHEN EXISTS (
          SELECT 1 FROM project_tasks pt WHERE pt.project_id = projects.id
        ) THEN 0
        ELSE 1
      END
    `);
  }

  const taskColumns = tableExists(db, "tasks")
    ? (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>)
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
  const validProjectIds = new Set((db.prepare("SELECT id FROM projects").all() as Array<{ id: number }>).map((row) => row.id));
  const validTaskIds = new Set(taskRows.map((row) => row.id));
  const assignmentKeySet = new Set<string>();
  const assignmentRows: Array<{ projectId: number; taskId: number; createdAt: string }> = [];

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
        company_id TEXT NOT NULL,
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
      db.prepare("INSERT INTO tasks (id, company_id, title, is_active, created_at) VALUES (?, ?, ?, ?, ?)").run(
        row.id,
        row.company_id,
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

export async function runSqliteMigrations(db: SqliteContext, kind: DatabaseKind) {
  if (kind !== "company") {
    return;
  }

  const umzug = new Umzug({
    migrations: [
      {
        name: "0001-modernize-company-workflow",
        up: async () => {
          await migrateCompanyWorkflow(db);
        },
        down: async () => {
          throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
        },
      },
      {
        name: "0002-repair-project-task-legacy-foreign-keys",
        up: async () => {
          await migrateCompanyWorkflow(db);
        },
        down: async () => {
          throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
        },
      },
      ...(await loadFileBasedMigrations(db)),
    ],
    storage: new SqliteMigrationStorage(db),
    context: db,
    logger: undefined,
  });

  await umzug.up();
}
