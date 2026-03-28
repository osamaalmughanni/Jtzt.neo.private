import { serve } from "@hono/node-server";
import { createApp } from "./api/app";
import { cleanupOrphanCompanyDatabases, createSystemDatabase } from "./db/runtime-database";
import { resolveRuntimeConfig } from "./runtime/env";

const config = await resolveRuntimeConfig();
const systemDb = await createSystemDatabase(config);
await cleanupOrphanCompanyDatabases(config, systemDb);
const app = createApp(config);

serve({
  fetch: (request) => app.fetch(request),
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0"
});

console.log(`Jtzt backend listening on http://localhost:${Number(process.env.PORT ?? 3000)}`);
