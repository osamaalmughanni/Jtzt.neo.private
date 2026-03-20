import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { RuntimeConfig } from "../runtime/types";
import { companySchema, systemSchema } from "../db/schema";

const COMPANY_TABLES = [
  "company_settings",
  "users",
  "user_contracts",
  "user_contract_schedule_days",
  "time_entries",
  "public_holiday_cache",
  "projects",
  "tasks",
] as const;

const COMPANY_ID_TABLES = [
  "company_settings",
  "users",
  "user_contracts",
  "time_entries",
  "public_holiday_cache",
  "projects",
  "tasks",
] as const;

function ensureNodeRuntime(config: RuntimeConfig) {
  if (config.runtime !== "node") {
    throw new HTTPException(501, { message: "SQLite company transfer is only available in the Node runtime" });
  }
}

function companyDatabasePath(config: RuntimeConfig, companyId: string) {
  return path.join(config.nodeCompanySqliteDir, `${companyId}.sqlite`);
}

function createTempSqlitePath(prefix: string) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}.sqlite`);
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function tableColumns(db: Database.Database, tableName: string) {
  return db.prepare(`SELECT name FROM pragma_table_info(${JSON.stringify(tableName)}) ORDER BY cid ASC`).all() as Array<{ name: string }>;
}

function initializeDatabase(filePath: string, schema: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  return db;
}

function readBackupMetadata(source: Database.Database) {
  const table = source
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'company_backup_metadata'")
    .get() as { name: string } | undefined;
  if (!table) {
    throw new HTTPException(400, { message: "Backup file is missing company_backup_metadata" });
  }

  const row = source.prepare("SELECT * FROM company_backup_metadata LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!row) {
    throw new HTTPException(400, { message: "Backup file does not contain company metadata" });
  }

  return row;
}

function clearCompanyTables(db: Database.Database) {
  const tx = db.transaction(() => {
    db.exec("DELETE FROM tasks");
    db.exec("DELETE FROM time_entries");
    db.exec("DELETE FROM user_contract_schedule_days");
    db.exec("DELETE FROM user_contracts");
    db.exec("DELETE FROM public_holiday_cache");
    db.exec("DELETE FROM company_settings");
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM projects");
  });
  tx();
}

function rewriteCompanyId(db: Database.Database, companyId: string) {
  const tx = db.transaction(() => {
    for (const tableName of COMPANY_ID_TABLES) {
      db.prepare(`UPDATE ${quoteIdentifier(tableName)} SET company_id = ?`).run(companyId);
    }
  });
  tx();
}

export function exportCompanyToSqlite(config: RuntimeConfig, companyId: string) {
  ensureNodeRuntime(config);

  const systemDb = initializeDatabase(config.nodeSystemSqlitePath, systemSchema);
  const sourcePath = companyDatabasePath(config, companyId);
  if (!fs.existsSync(sourcePath)) {
    throw new HTTPException(404, { message: "Company database not found" });
  }

  const company = systemDb.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as Record<string, unknown> | undefined;
  if (!company) {
    throw new HTTPException(404, { message: "Company not found" });
  }

  const tempPath = createTempSqlitePath("jtzt-company-export");
  fs.copyFileSync(sourcePath, tempPath);

  const target = new Database(tempPath);
  try {
    target.exec(`
      CREATE TABLE IF NOT EXISTS company_backup_metadata (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        encryption_enabled INTEGER NOT NULL,
        encryption_kdf_algorithm TEXT,
        encryption_kdf_iterations INTEGER,
        encryption_kdf_salt TEXT,
        encryption_key_verifier TEXT,
        api_key_hash TEXT,
        api_key_created_at TEXT,
        tablet_code_value TEXT,
        tablet_code_hash TEXT,
        tablet_code_updated_at TEXT,
        created_at TEXT NOT NULL
      );
      DELETE FROM company_backup_metadata;
    `);
    target
      .prepare(
        `INSERT INTO company_backup_metadata (
          id, name, encryption_enabled, encryption_kdf_algorithm, encryption_kdf_iterations, encryption_kdf_salt,
          encryption_key_verifier, api_key_hash, api_key_created_at, tablet_code_value, tablet_code_hash,
          tablet_code_updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        company.id,
        company.name,
        company.encryption_enabled,
        company.encryption_kdf_algorithm,
        company.encryption_kdf_iterations,
        company.encryption_kdf_salt,
        company.encryption_key_verifier,
        company.api_key_hash,
        company.api_key_created_at,
        company.tablet_code_value,
        company.tablet_code_hash,
        company.tablet_code_updated_at,
        company.created_at,
      );
  } finally {
    target.close();
    systemDb.close();
  }

  return {
    filePath: tempPath,
    fileName: `${String(company.name).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}.company.sqlite`,
  };
}

export function importCompanyFromSqlite(config: RuntimeConfig, sourceFilePath: string, options: { companyId?: string; companyName?: string }) {
  ensureNodeRuntime(config);

  const systemDb = initializeDatabase(config.nodeSystemSqlitePath, systemSchema);
  const sourceDb = new Database(sourceFilePath, { readonly: true });

  try {
    const metadata = readBackupMetadata(sourceDb);
    const desiredCompanyId = options.companyId?.trim() || String(metadata.id || crypto.randomUUID());
    const desiredCompanyName = options.companyName?.trim() || String(metadata.name || "").trim();
    if (!desiredCompanyName) {
      throw new HTTPException(400, { message: "Backup file does not contain a valid company name" });
    }

    const existingByName = systemDb
      .prepare("SELECT id FROM companies WHERE lower(name) = lower(?)")
      .get(desiredCompanyName) as { id: string } | undefined;
    if (existingByName && existingByName.id !== desiredCompanyId) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    const targetDb = initializeDatabase(companyDatabasePath(config, desiredCompanyId), companySchema);
    try {
      targetDb.exec(`ATTACH DATABASE ${JSON.stringify(sourceFilePath)} AS source`);
      clearCompanyTables(targetDb);

      for (const tableName of COMPANY_TABLES) {
        const columns = tableColumns(sourceDb, tableName).map((column) => column.name);
        if (columns.length === 0) {
          continue;
        }
        const quotedColumns = columns.map(quoteIdentifier).join(", ");
        targetDb.exec(
          `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns})
           SELECT ${quotedColumns}
           FROM source.${quoteIdentifier(tableName)}`
        );
      }

      rewriteCompanyId(targetDb, desiredCompanyId);
      targetDb.exec("DETACH DATABASE source");
    } finally {
      targetDb.close();
    }

    const existingCompany = systemDb.prepare("SELECT id FROM companies WHERE id = ?").get(desiredCompanyId) as { id: string } | undefined;
    const values = [
      desiredCompanyId,
      desiredCompanyName,
      Number(metadata.encryption_enabled ?? 0),
      metadata.encryption_kdf_algorithm ?? null,
      metadata.encryption_kdf_iterations ?? null,
      metadata.encryption_kdf_salt ?? null,
      metadata.encryption_key_verifier ?? null,
      metadata.api_key_hash ?? null,
      metadata.api_key_created_at ?? null,
      metadata.tablet_code_value ?? null,
      metadata.tablet_code_hash ?? null,
      metadata.tablet_code_updated_at ?? null,
      String(metadata.created_at ?? new Date().toISOString()),
    ];

    if (existingCompany) {
      systemDb
        .prepare(
          `UPDATE companies
           SET name = ?, encryption_enabled = ?, encryption_kdf_algorithm = ?, encryption_kdf_iterations = ?,
               encryption_kdf_salt = ?, encryption_key_verifier = ?, api_key_hash = ?, api_key_created_at = ?,
               tablet_code_value = ?, tablet_code_hash = ?, tablet_code_updated_at = ?, created_at = ?
           WHERE id = ?`
        )
        .run(
          desiredCompanyName,
          values[2],
          values[3],
          values[4],
          values[5],
          values[6],
          values[7],
          values[8],
          values[9],
          values[10],
          values[11],
          values[12],
          desiredCompanyId,
        );
    } else {
      systemDb
        .prepare(
          `INSERT INTO companies (
            id, name, encryption_enabled, encryption_kdf_algorithm, encryption_kdf_iterations, encryption_kdf_salt,
            encryption_key_verifier, api_key_hash, api_key_created_at, tablet_code_value, tablet_code_hash,
            tablet_code_updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(...values);
    }

    return { companyId: desiredCompanyId, companyName: desiredCompanyName };
  } finally {
    systemDb.close();
    sourceDb.close();
  }
}
