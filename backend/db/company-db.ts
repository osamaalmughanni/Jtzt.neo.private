import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { companySchema } from "./schema";

const companyConnections = new Map<string, Database.Database>();

type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

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

const companyMigrations: Migration[] = [
  {
    id: "001_company_core",
    up(db) {
      db.exec(companySchema);
    }
  }
];

export function sanitizeCompanySlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function createCompanyDbPath(companyName: string): string {
  return path.resolve(appConfig.dataDir, `company_${sanitizeCompanySlug(companyName)}.db`);
}

export function initializeCompanyDatabase(databasePath: string): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  applyMigrations(db, companyMigrations);
  return db;
}

export function getCompanyDb(databasePath: string): Database.Database {
  const cached = companyConnections.get(databasePath);
  if (cached) {
    return cached;
  }

  const db = initializeCompanyDatabase(databasePath);
  companyConnections.set(databasePath, db);
  return db;
}

export function closeCompanyDb(databasePath: string): void {
  const db = companyConnections.get(databasePath);
  if (!db) {
    return;
  }

  db.close();
  companyConnections.delete(databasePath);
}

export function seedCompanyAdmin(
  databasePath: string,
  payload: { username: string; password: string; fullName: string }
): void {
  seedCompanyUser(databasePath, {
    username: payload.username,
    password: payload.password,
    fullName: payload.fullName,
    role: "company_admin"
  });
  seedDefaultProjects(databasePath);
}

export function seedCompanyUser(
  databasePath: string,
  payload: { username: string; password: string; fullName: string; role: "employee" | "company_admin" }
): number {
  const db = getCompanyDb(databasePath);
  const result = db
    .prepare(
      "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (@username, @fullName, @passwordHash, @role, @createdAt)"
    )
    .run({
      username: payload.username,
      fullName: payload.fullName,
      passwordHash: bcrypt.hashSync(payload.password, 10),
      role: payload.role,
      createdAt: new Date().toISOString()
    });

  return Number(result.lastInsertRowid);
}

export function seedDefaultProjects(databasePath: string): void {
  const db = getCompanyDb(databasePath);
  const insertProject = db.prepare("INSERT INTO projects (name, description, created_at) VALUES (@name, @description, @createdAt)");

  for (const project of [
    { name: "Operations", description: "General company operations" },
    { name: "Internal", description: "Internal tasks and support" }
  ]) {
    insertProject.run({ ...project, createdAt: new Date().toISOString() });
  }
}
