import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DatabaseKind } from "./app-database";

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
};

function getMigrationFolder(kind: DatabaseKind) {
  return path.join(process.cwd(), "backend", "db", "migrations", kind);
}

function hasTable(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row?.name);
}

function hasLiveSchema(db: Database.Database, kind: DatabaseKind) {
  if (kind === "system") {
    return hasTable(db, "companies") || hasTable(db, "jtzt_system_migrations");
  }

  return hasTable(db, "company_settings") || hasTable(db, "users") || hasTable(db, "jtzt_company_migrations");
}

function readLatestMigration(folder: string) {
  const journalPath = path.join(folder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    return null;
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries?: JournalEntry[] };
  const latest = journal.entries?.at(-1);
  if (!latest) {
    return null;
  }

  const sqlPath = path.join(folder, `${latest.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing Drizzle migration SQL file: ${sqlPath}`);
  }

  const sqlSource = fs.readFileSync(sqlPath, "utf8");
  return {
    createdAt: latest.when,
    hash: crypto.createHash("sha256").update(sqlSource).digest("hex"),
  };
}

function ensureDrizzleBaseline(db: Database.Database, kind: DatabaseKind) {
  if (hasTable(db, DRIZZLE_MIGRATIONS_TABLE) || !hasLiveSchema(db, kind)) {
    return;
  }

  const latestMigration = readLatestMigration(getMigrationFolder(kind));
  if (!latestMigration) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${DRIZZLE_MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);

  const existing = db
    .prepare(`SELECT id FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { id: number } | undefined;
  if (existing) {
    return;
  }

  db.prepare(`INSERT INTO ${DRIZZLE_MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`).run(
    latestMigration.hash,
    latestMigration.createdAt,
  );
}

function dropLegacyMigrationTables(db: Database.Database, kind: DatabaseKind) {
  const legacyTable = kind === "system" ? "jtzt_system_migrations" : "jtzt_company_migrations";
  db.exec(`DROP TABLE IF EXISTS ${legacyTable}`);
}

export async function runSqliteMigrations(db: Database.Database, kind: DatabaseKind) {
  ensureDrizzleBaseline(db, kind);
  migrate(drizzle(db), {
    migrationsFolder: getMigrationFolder(kind),
  });
  dropLegacyMigrationTables(db, kind);
}
