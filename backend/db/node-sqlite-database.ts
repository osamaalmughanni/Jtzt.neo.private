import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hardenSchemaForDatabase, type DatabaseKind } from "./app-database";
import { runSqliteMigrations } from "./drizzle-migrations";
import type { AppDatabase, RunResult, SqlStatement, SqlValue } from "../runtime/types";

const nodeConnections = new Map<string, Database.Database>();

function normalizeParams(params?: SqlValue[]) {
  return params ?? [];
}

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

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      await ensureSchemaReady();
      return connection.prepare(sql).all(...normalizeParams(params)) as T[];
    },

    async first<T>(sql: string, params?: SqlValue[]) {
      await ensureSchemaReady();
      return (connection.prepare(sql).get(...normalizeParams(params)) as T | undefined) ?? null;
    },

    async run(sql: string, params?: SqlValue[]): Promise<RunResult> {
      await ensureSchemaReady();
      const result = connection.prepare(sql).run(...normalizeParams(params));
      return {
        changes: result.changes,
        lastRowId: typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : Number(result.lastInsertRowid ?? 0) || null,
      };
    },

    async batch(statements: SqlStatement[]) {
      await ensureSchemaReady();
      const results: RunResult[] = [];
      const transaction = connection.transaction(() => {
        for (const statement of statements) {
          const result = connection.prepare(statement.sql).run(...normalizeParams(statement.params));
          results.push({
            changes: result.changes,
            lastRowId: typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : Number(result.lastInsertRowid ?? 0) || null,
          });
        }
      });
      transaction();
      return results;
    },

    async exec(sql: string) {
      await ensureSchemaReady();
      connection.exec(sql);
    },
  };
}
