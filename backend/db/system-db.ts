import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { appSchema } from "./schema";

let currentDbPath = appConfig.appDbPath;
let appDb: Database.Database | null = null;

function initializeDatabase(databasePath: string): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(appSchema);

  const row = db.prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number };
  if (row.count === 0) {
    db.prepare("INSERT INTO admins (username, password_hash, created_at) VALUES (@username, @passwordHash, @createdAt)").run({
      username: "admin",
      passwordHash: bcrypt.hashSync("admin123", 10),
      createdAt: new Date().toISOString()
    });
  }

  return db;
}

export function getSystemDb(): Database.Database {
  if (!appDb) {
    appDb = initializeDatabase(currentDbPath);
  }

  return appDb;
}

export function closeSystemDb(): void {
  if (!appDb) {
    return;
  }

  appDb.close();
  appDb = null;
}

export function setSystemDbPathForTests(databasePath: string): void {
  closeSystemDb();
  currentDbPath = databasePath;
}
