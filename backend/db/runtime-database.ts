import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { type DatabaseKind } from "./database-kind";
import { runSqliteMigrations } from "./drizzle-migrations";
import { companies } from "./schema/system";
import * as companySchema from "./schema/company";
import * as systemSchema from "./schema/system";
import type { NodeDatabase } from "../runtime/types";

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

export async function createNodeDatabase(databasePath: string, kind: DatabaseKind): Promise<NodeDatabase> {
  const connection = initializeSqliteConnection(databasePath, kind);
  const orm = kind === "system"
    ? (drizzle(connection, { schema: systemSchema }) as unknown as NodeDatabase["orm"])
    : (drizzle(connection, { schema: companySchema }) as unknown as NodeDatabase["orm"]);
  let schemaReadyPromise: Promise<void> | null = null;

  async function ensureSchemaReady() {
    if (!schemaReadyPromise) {
      schemaReadyPromise = (async () => {
        await runSqliteMigrations(connection, kind);
      })().catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
    }

    await schemaReadyPromise;
  }

  await ensureSchemaReady();

  return {
    orm,
    sqlite: connection,
  };
}

export async function createSystemDatabase(config: { nodeSystemSqlitePath: string }) {
  return createNodeDatabase(config.nodeSystemSqlitePath, "system");
}

export async function createCompanyDatabase(config: { nodeCompanySqliteDir: string }, companyId: string) {
  const databasePath = path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`);
  return createNodeDatabase(databasePath, "company");
}

export async function destroyCompanyDatabase(config: { nodeCompanySqliteDir: string }, companyId: string) {
  const databasePath = path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`);
  closeNodeDatabaseConnection(databasePath);
  if (fs.existsSync(databasePath)) {
    fs.unlinkSync(databasePath);
  }
}

export async function cleanupOrphanCompanyDatabases(
  config: { nodeCompanySqliteDir: string },
  systemDb: NodeDatabase,
) {
  await fsp.mkdir(config.nodeCompanySqliteDir, { recursive: true });
  const rows = await systemDb.orm.select({ id: companies.id }).from(companies) as Array<{ id: string }>;
  const knownCompanyIds = new Set(rows.map((row) => row.id));
  const entries = await fsp.readdir(config.nodeCompanySqliteDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sqlite")) {
      continue;
    }

    const companyId = path.basename(entry.name, ".sqlite");
    if (knownCompanyIds.has(companyId)) {
      continue;
    }

    const databasePath = path.join(config.nodeCompanySqliteDir, entry.name);
    closeNodeDatabaseConnection(databasePath);
    await fsp.unlink(databasePath).catch(() => undefined);
  }
}
