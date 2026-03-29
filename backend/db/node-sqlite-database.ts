import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hardenSchemaForDatabase, type DatabaseKind } from "./app-database";
import { runSqliteMigrations } from "./drizzle-migrations";
import { companies } from "./schema/system";
import * as companySchema from "./schema/company";
import * as systemSchema from "./schema/system";
import type { AppDatabase } from "../runtime/types";

const nodeConnections = new Map<string, Database.Database>();

export function initializeSqliteConnection(databasePath: string, kind: DatabaseKind): Database.Database {
  const existing = nodeConnections.get(databasePath);
  if (existing) {
    return existing;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -20000");
  nodeConnections.set(databasePath, db);
  return db;
}

export function closeNodeDatabaseConnection(databasePath: string) {
  const connection = nodeConnections.get(databasePath);
  if (!connection) {
    return;
  }

  nodeConnections.delete(databasePath);
  connection.close();
}

export async function createNodeDatabase(databasePath: string, kind: DatabaseKind): Promise<AppDatabase> {
  const connection = initializeSqliteConnection(databasePath, kind);
  const orm = kind === "system"
    ? (drizzle(connection, { schema: systemSchema }) as unknown as AppDatabase["orm"])
    : (drizzle(connection, { schema: companySchema }) as unknown as AppDatabase["orm"]);
  let schemaReadyPromise: Promise<void> | null = null;

  async function ensureSchemaReady() {
    if (!schemaReadyPromise) {
      schemaReadyPromise = (async () => {
        await runSqliteMigrations(connection, kind);
        hardenSchemaForDatabase(connection, kind);
      })().catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
    }

    await schemaReadyPromise;
  }

  await ensureSchemaReady();

  return {
    sqlite: connection,
    orm,
  };
}
