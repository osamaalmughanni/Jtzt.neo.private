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
    const migrationModule = (await import(moduleUrl)) as {
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

export async function runSqliteMigrations(db: SqliteContext, kind: DatabaseKind) {
  if (kind !== "company") {
    return;
  }

  const umzug = new Umzug({
    migrations: await loadFileBasedMigrations(db),
    storage: new SqliteMigrationStorage(db),
    context: db,
    logger: undefined,
  });

  await umzug.up();
}
