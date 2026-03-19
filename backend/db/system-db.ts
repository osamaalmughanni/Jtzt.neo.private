import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { appSchema } from "./schema";

let currentDbPath = path.resolve(process.cwd(), "data", "app.db");
let connection: Database.Database | null = null;

function initialize(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(appSchema);
  return db;
}

export function getSystemDb(): Database.Database {
  if (!connection) {
    connection = initialize(currentDbPath);
  }
  return connection;
}

export function closeSystemDb() {
  if (!connection) {
    return;
  }
  connection.close();
  connection = null;
}

export function setSystemDbPathForTests(databasePath: string) {
  closeSystemDb();
  currentDbPath = databasePath;
}
