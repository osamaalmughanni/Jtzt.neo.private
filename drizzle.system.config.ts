import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/db/schema/system.ts",
  out: "./backend/db/migrations/system",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/system.sqlite",
  },
  breakpoints: true,
  verbose: true,
  strict: true,
});
