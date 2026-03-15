import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { companySchema } from "./schema";

const companyConnections = new Map<string, Database.Database>();

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
  db.exec(companySchema);
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
  const db = getCompanyDb(databasePath);
  db.prepare(
    "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (@username, @fullName, @passwordHash, 'company_admin', @createdAt)"
  ).run({
    username: payload.username,
    fullName: payload.fullName,
    passwordHash: bcrypt.hashSync(payload.password, 10),
    createdAt: new Date().toISOString()
  });

  seedDefaultProjects(databasePath);
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
