import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppDatabase, D1DatabaseLike, D1PreparedStatementLike, RunResult, SqlStatement, SqlValue } from "../runtime/types";
import { appSchema } from "./schema";

const nodeConnections = new Map<string, Database.Database>();

function normalizeParams(params?: SqlValue[]) {
  return params ?? [];
}

function getOrCreateNodeConnection(databasePath: string) {
  const existing = nodeConnections.get(databasePath);
  if (existing) {
    return existing;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(appSchema);
  nodeConnections.set(databasePath, db);
  return db;
}

export function createNodeDatabase(databasePath: string): AppDatabase {
  const connection = getOrCreateNodeConnection(databasePath);

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return connection.prepare(sql).all(...normalizeParams(params)) as T[];
    },

    async first<T>(sql: string, params?: SqlValue[]) {
      return (connection.prepare(sql).get(...normalizeParams(params)) as T | undefined) ?? null;
    },

    async run(sql: string, params?: SqlValue[]): Promise<RunResult> {
      const result = connection.prepare(sql).run(...normalizeParams(params));
      return {
        changes: result.changes,
        lastRowId: typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : Number(result.lastInsertRowid ?? 0) || null
      };
    },

    async batch(statements: SqlStatement[]) {
      const results: RunResult[] = [];
      const transaction = connection.transaction(() => {
        for (const statement of statements) {
          const result = connection.prepare(statement.sql).run(...normalizeParams(statement.params));
          results.push({
            changes: result.changes,
            lastRowId: typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : Number(result.lastInsertRowid ?? 0) || null
          });
        }
      });
      transaction();
      return results;
    },

    async exec(sql: string) {
      connection.exec(sql);
    }
  };
}

function mapD1Result(result: { meta?: { changes?: number; last_row_id?: number } }): RunResult {
  return {
    changes: result.meta?.changes ?? 0,
    lastRowId: result.meta?.last_row_id ?? null
  };
}

async function withD1Retry<T>(fn: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/retry|timeout|busy|locked|network/i.test(error.message) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  throw lastError;
}

function bindStatement(statement: D1PreparedStatementLike, params?: SqlValue[]) {
  return statement.bind(...normalizeParams(params));
}

export function createD1Database(database: D1DatabaseLike): AppDatabase {
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return withD1Retry(async () => {
        const result = await bindStatement(database.prepare(sql), params).all<T>();
        return result.results ?? [];
      });
    },

    async first<T>(sql: string, params?: SqlValue[]) {
      return withD1Retry(async () => (await bindStatement(database.prepare(sql), params).first<T>()) ?? null);
    },

    async run(sql: string, params?: SqlValue[]) {
      return withD1Retry(async () => mapD1Result(await bindStatement(database.prepare(sql), params).run()));
    },

    async batch(statements: SqlStatement[]) {
      return withD1Retry(async () => {
        const bound = statements.map((statement) => bindStatement(database.prepare(statement.sql), statement.params));
        return (await database.batch(bound)).map(mapD1Result);
      });
    },

    async exec(sql: string) {
      await withD1Retry(async () => {
        await database.exec(sql);
      });
    }
  };
}
