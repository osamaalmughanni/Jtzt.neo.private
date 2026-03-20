import { serve } from "@hono/node-server";
import { app } from "./api/app";
import { resolveRuntimeConfig } from "./runtime/env";
import type { RuntimeBindings } from "./runtime/types";

const config = resolveRuntimeConfig();

const bindings: RuntimeBindings = {
  APP_ENV: config.appEnv,
  APP_VERSION: config.appVersion,
  JWT_SECRET: config.jwtSecret,
  SESSION_TTL_HOURS: String(config.sessionTtlHours),
  NODE_SQLITE_PATH: config.nodeSqlitePath,
  ADMIN_ACCESS_TOKEN: config.adminAccessToken
};

serve({
  fetch: (request) => app.fetch(request, bindings),
  port: Number(process.env.PORT ?? 3000)
});

console.log(`Jtzt backend listening on http://localhost:${Number(process.env.PORT ?? 3000)}`);
