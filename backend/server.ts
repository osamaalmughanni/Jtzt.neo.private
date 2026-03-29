import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./api/app";
import { cleanupOrphanCompanyDatabases, createCompanyDatabase, createSystemDatabase } from "./db/runtime-database";
import { companies } from "./db/schema/system";
import { resolveRuntimeConfig } from "./runtime/env";

async function migrateDatabases() {
  const config = await resolveRuntimeConfig();
  const startedAt = Date.now();

  const systemDb = await createSystemDatabase(config);
  const companyRows = await systemDb.orm.select({ id: companies.id, name: companies.name }).from(companies) as Array<{
    id: string;
    name: string;
  }>;
  const companyIds = companyRows.map((row) => row.id);

  for (const companyId of companyIds) {
    const companyPath = path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`);
    if (!fs.existsSync(companyPath)) {
      continue;
    }

    await createCompanyDatabase(config, companyId);
  }

  await cleanupOrphanCompanyDatabases(config, systemDb);

  const durationMs = Date.now() - startedAt;
  console.log("JTZT MIGRATION REPORT");
  console.log(`System DB: ${config.nodeSystemSqlitePath}`);
  console.log(`Company DB directory: ${config.nodeCompanySqliteDir}`);
  console.log(`Companies discovered: ${companyRows.length}`);
  console.log(`Companies migrated: ${companyIds.length}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log("Status: success");
}

async function serveBackend() {
  const config = await resolveRuntimeConfig();
  const systemDb = await createSystemDatabase(config);
  await cleanupOrphanCompanyDatabases(config, systemDb);
  const app = createApp(config);

  serve({
    fetch: (request) => app.fetch(request),
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
  });

  console.log(`Jtzt backend listening on http://localhost:${Number(process.env.PORT ?? 3000)}`);
}

const mode = (process.argv[2] ?? "").toLowerCase();
if (mode === "migrate") {
  await migrateDatabases();
} else {
  await serveBackend();
}
