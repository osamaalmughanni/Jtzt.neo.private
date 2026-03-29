import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./backend/db/schema/company.ts",
  out: "./backend/db/migrations/company",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/company-template.sqlite",
  },
  breakpoints: true,
  verbose: true,
  strict: true,
});
