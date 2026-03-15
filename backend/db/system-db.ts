import fs from "node:fs";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { systemSchema } from "./schema";

let systemDb: Database.Database | null = null;

type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyMigrations(db: Database.Database, migrations: Migration[]) {
  ensureMigrationTable(db);

  for (const migration of migrations) {
    const existing = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(migration.id);
    if (existing) {
      continue;
    }

    const transaction = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date().toISOString());
    });

    transaction();
  }
}

const systemMigrations: Migration[] = [
  {
    id: "001_system_core",
    up(db) {
      db.exec(systemSchema);
    }
  },
  {
    id: "002_company_encryption_columns",
    up(db) {
      ensureColumn(db, "companies", "encryption_enabled", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "companies", "encryption_kdf_algorithm", "TEXT");
      ensureColumn(db, "companies", "encryption_kdf_iterations", "INTEGER");
      ensureColumn(db, "companies", "encryption_kdf_salt", "TEXT");
      ensureColumn(db, "companies", "encryption_key_verifier", "TEXT");
    }
  }
];

export function getSystemDb(): Database.Database {
  if (systemDb) {
    return systemDb;
  }

  fs.mkdirSync(appConfig.dataDir, { recursive: true });
  systemDb = new Database(appConfig.systemDbPath);
  systemDb.pragma("journal_mode = WAL");
  applyMigrations(systemDb, systemMigrations);

  const row = systemDb.prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number };
  if (row.count === 0) {
    systemDb
      .prepare(
        "INSERT INTO admins (username, password_hash, created_at) VALUES (@username, @passwordHash, @createdAt)"
      )
      .run({
        username: "admin",
        passwordHash: bcrypt.hashSync("admin123", 10),
        createdAt: new Date().toISOString()
      });
  }

  return systemDb;
}
