import { serve } from "@hono/node-server";
import { createApp } from "./api/app";
import { resolveRuntimeConfig } from "./runtime/env";

const config = await resolveRuntimeConfig();
const app = createApp(config);

serve({
  fetch: (request) => app.fetch(request),
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0"
});

console.log(`Jtzt backend listening on http://localhost:${Number(process.env.PORT ?? 3000)}`);
