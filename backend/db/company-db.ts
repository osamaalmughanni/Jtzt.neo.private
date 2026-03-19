import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { getSystemDb } from "./system-db";

export type CompanyScopedTable =
  | "users"
  | "user_contracts"
  | "time_entries"
  | "company_settings"
  | "public_holiday_cache"
  | "projects"
  | "tasks";

export function getCompanyDb(_companyId: string): Database.Database {
  return getSystemDb();
}

export function closeCompanyDb(_companyId?: string): void {
  void _companyId;
}

export function seedCompanyAdmin(
  companyId: string,
  payload: { username: string; password: string; fullName: string }
): number {
  return seedCompanyUser(companyId, {
    username: payload.username,
    password: payload.password,
    fullName: payload.fullName,
    role: "admin"
  });
}

export function seedCompanyUser(
  companyId: string,
  payload: { username: string; password: string; fullName: string; role: "employee" | "manager" | "admin" }
): number {
  const db = getSystemDb();
  const result = db
    .prepare(
      `INSERT INTO users (
        company_id,
        username,
        full_name,
        password_hash,
        role,
        created_at
      ) VALUES (
        @companyId,
        @username,
        @fullName,
        @passwordHash,
        @role,
        @createdAt
      )`
    )
    .run({
      companyId,
      username: payload.username.trim(),
      fullName: payload.fullName.trim(),
      passwordHash: bcrypt.hashSync(payload.password, 10),
      role: payload.role,
      createdAt: new Date().toISOString()
    });

  return Number(result.lastInsertRowid);
}

export function seedDefaultProjects(companyId: string): void {
  const db = getSystemDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM projects WHERE company_id = ?")
    .get(companyId) as { count: number };
  if (row.count > 0) {
    return;
  }

  db.prepare("INSERT INTO projects (company_id, name, description, created_at) VALUES (?, ?, ?, ?)").run(
    companyId,
    "General",
    "Default project",
    new Date().toISOString()
  );
}

export function deleteCompanyData(companyId: string): void {
  const db = getSystemDb();
  const tables: CompanyScopedTable[] = [
    "tasks",
    "projects",
    "time_entries",
    "user_contracts",
    "public_holiday_cache",
    "company_settings",
    "users"
  ];

  const transaction = db.transaction(() => {
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE company_id = ?`).run(companyId);
    }
  });

  transaction();
}
