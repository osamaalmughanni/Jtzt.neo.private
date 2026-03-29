import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runSqliteMigrations } from "../backend/db/drizzle-migrations";
import { resolveRuntimeConfig } from "../backend/runtime/env";

async function migrateSystem() {
  const config = await resolveRuntimeConfig();
  fs.mkdirSync(path.dirname(config.nodeSystemSqlitePath), { recursive: true });
  const db = new Database(config.nodeSystemSqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    await runSqliteMigrations(db, "system");
    console.log(`Migrated system database: ${config.nodeSystemSqlitePath}`);
  } finally {
    db.close();
  }
}

async function migrateCompanies() {
  const config = await resolveRuntimeConfig();
  fs.mkdirSync(config.nodeCompanySqliteDir, { recursive: true });
  const entries = fs.readdirSync(config.nodeCompanySqliteDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sqlite")) {
      continue;
    }

    const databasePath = path.join(config.nodeCompanySqliteDir, entry.name);
    const db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    try {
      await runSqliteMigrations(db, "company");
      console.log(`Migrated company database: ${databasePath}`);
    } finally {
      db.close();
    }
  }
}

async function main() {
  const mode = (process.argv[2] ?? "all").toLowerCase();
  if (mode === "all" || mode === "system") {
    await migrateSystem();
  }
  if (mode === "all" || mode === "companies") {
    await migrateCompanies();
  }
}

void main();
