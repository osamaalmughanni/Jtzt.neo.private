import { createDurableObjectDatabase } from "./durable-object-database";
import { companySchema, systemSchema } from "./schema";
import type { AppDatabase, DurableObjectNamespaceLike, RuntimeBindings, RuntimeConfig } from "../runtime/types";

const SYSTEM_OBJECT_NAME = "system";

function requireNamespace(namespace: DurableObjectNamespaceLike | undefined, bindingName: string) {
  if (!namespace) {
    throw new Error(`${bindingName} Durable Object binding is not configured`);
  }
  return namespace;
}

export async function createSystemDatabase(config: RuntimeConfig, bindings?: RuntimeBindings): Promise<AppDatabase> {
  if (config.runtime === "cloudflare") {
    const namespace = requireNamespace(bindings?.SYSTEM_DO, "SYSTEM_DO");
    return createDurableObjectDatabase(namespace.get(namespace.idFromName(SYSTEM_OBJECT_NAME)));
  }

  const { createNodeDatabase } = await import("./node-sqlite-database");
  return createNodeDatabase(config.nodeSystemSqlitePath, systemSchema, "system");
}

export async function createCompanyDatabase(config: RuntimeConfig, companyId: string, bindings?: RuntimeBindings): Promise<AppDatabase> {
  if (config.runtime === "cloudflare") {
    const namespace = requireNamespace(bindings?.COMPANY_DO, "COMPANY_DO");
    return createDurableObjectDatabase(namespace.get(namespace.idFromName(companyId)));
  }

  const [{ createNodeDatabase }, path] = await Promise.all([import("./node-sqlite-database"), import("node:path")]);
  return createNodeDatabase(path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`), companySchema, "company");
}

export async function destroyCompanyDatabase(config: RuntimeConfig, companyId: string, bindings?: RuntimeBindings) {
  if (config.runtime === "cloudflare") {
    const namespace = requireNamespace(bindings?.COMPANY_DO, "COMPANY_DO");
    const stub = namespace.get(namespace.idFromName(companyId));
    const response = await stub.fetch("https://internal-jtzt/admin/reset", { method: "POST" });
    if (!response.ok) {
      throw new Error(`Could not reset company Durable Object storage for ${companyId}`);
    }
    return;
  }

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
