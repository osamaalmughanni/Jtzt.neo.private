import { companySchema, systemSchema } from "./schema";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";

export async function createSystemDatabase(config: RuntimeConfig): Promise<AppDatabase> {
  const { createNodeDatabase } = await import("./node-sqlite-database");
  return createNodeDatabase(config.nodeSystemSqlitePath, systemSchema, "system");
}

export async function createCompanyDatabase(config: RuntimeConfig, companyId: string): Promise<AppDatabase> {
  const [{ createNodeDatabase }, path] = await Promise.all([import("./node-sqlite-database"), import("node:path")]);
  return createNodeDatabase(path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`), companySchema, "company");
}

export async function destroyCompanyDatabase(config: RuntimeConfig, companyId: string) {
  const [fs, { closeNodeDatabaseConnection }, path] = await Promise.all([
    import("node:fs/promises"),
    import("./node-sqlite-database"),
    import("node:path"),
  ]);
  const databasePath = path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`);
  closeNodeDatabaseConnection(databasePath);
  await fs.rm(databasePath, {
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
}
