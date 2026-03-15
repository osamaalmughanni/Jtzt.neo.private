import { serve } from "@hono/node-server";
import { app } from "./api/app";
import { appConfig } from "./config";
import { getSystemDb } from "./db/system-db";

getSystemDb();

serve({
  fetch: app.fetch,
  port: appConfig.port
});

console.log(`Jtzt backend listening on http://localhost:${appConfig.port}`);
