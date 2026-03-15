import fs from "node:fs";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { systemSchema } from "./schema";

let systemDb: Database.Database | null = null;

export function getSystemDb(): Database.Database {
  if (systemDb) {
    return systemDb;
  }

  fs.mkdirSync(appConfig.dataDir, { recursive: true });
  systemDb = new Database(appConfig.systemDbPath);
  systemDb.pragma("journal_mode = WAL");
  systemDb.exec(systemSchema);

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
