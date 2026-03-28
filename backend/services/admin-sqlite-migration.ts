import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { companySchema } from "../db/schema";
import type { AppDatabase, SqlValue } from "../runtime/types";
import { systemService } from "./system-service";

const MIGRATION_PACKAGE_KEY = "jtzt-company-sqlite-migration";
const MIGRATION_PACKAGE_VERSION = 1;
const MIGRATION_METADATA_TABLE = "jtzt_migration_metadata";
const SQLITE_CONTENT_TYPE = "application/x-sqlite3";
const EXCLUDED_TABLES = new Set(["sqlite_sequence", MIGRATION_METADATA_TABLE]);

type MigrationColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

type MigrationForeignKey = {
  column: string;
  referencedTable: string;
  referencedColumn: string;
};

type MigrationTable = {
  name: string;
  columns: MigrationColumn[];
  foreignKeys: MigrationForeignKey[];
  hasCompanyId: boolean;
  primaryKeyColumns: string[];
};

type PackageMetadataColumn = MigrationColumn & {
  example: string | number | null;
};

type BetterSqliteDatabase = {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  exec(source: string): unknown;
  prepare(source: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
  transaction<F extends (...params: any[]) => any>(fn: F): F;
  serialize(): Buffer;
};

const PACKAGE_SCHEMA_SQL = `${companySchema}

CREATE TABLE IF NOT EXISTS ${MIGRATION_METADATA_TABLE} (
  package_key TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  exported_at TEXT NOT NULL,
  source_schema_hash TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  original_company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_hash TEXT,
  api_key_created_at TEXT,
  tablet_code_value TEXT,
  tablet_code_hash TEXT,
  tablet_code_updated_at TEXT,
  created_at TEXT NOT NULL
);`;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function splitTopLevelCommaSegments(value: string) {
  const segments: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      segments.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    segments.push(current);
  }

  return segments;
}

function parseColumnsFromCreateTableSql(createTableSql: string) {
  const start = createTableSql.indexOf("(");
  const end = createTableSql.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) {
    return { columns: [] as MigrationColumn[], foreignKeys: [] as MigrationForeignKey[] };
  }

  const body = createTableSql.slice(start + 1, end);
  const segments = splitTopLevelCommaSegments(body).map((segment) => segment.trim()).filter(Boolean);
  const columns: MigrationColumn[] = [];
  const foreignKeys: MigrationForeignKey[] = [];

  for (const segment of segments) {
    if (/^foreign key\b/i.test(segment)) {
      const match = segment.match(
        /^foreign key\s*\(\s*"?(?<column>[A-Za-z_][A-Za-z0-9_]*)"?\s*\)\s*references\s*"?(?<table>[A-Za-z_][A-Za-z0-9_]*)"?\s*\(\s*"?(?<refColumn>[A-Za-z_][A-Za-z0-9_]*)"?\s*\)/i,
      );
      if (match?.groups?.column && match.groups.table && match.groups.refColumn) {
        foreignKeys.push({
          column: match.groups.column,
          referencedTable: match.groups.table,
          referencedColumn: match.groups.refColumn,
        });
      }
      continue;
    }

    if (/^(constraint|primary key|unique|check)\b/i.test(segment)) {
      continue;
    }

    const match = segment.match(/^"?(?<name>[A-Za-z_][A-Za-z0-9_]*)"?\s+(?<rest>.+)$/s);
    if (!match?.groups?.name || !match.groups.rest) {
      continue;
    }

    const rest = match.groups.rest.trim();
    const typeMatch = rest.match(/^(?<type>[A-Za-z0-9_()]+(?:\s+[A-Za-z0-9_()]+)?)/);
    const normalizedRest = rest.toUpperCase();
    columns.push({
      name: match.groups.name,
      type: typeMatch?.groups?.type?.trim() || "TEXT",
      nullable: !normalizedRest.includes("NOT NULL"),
      primaryKey: normalizedRest.includes("PRIMARY KEY"),
    });
  }

  return { columns, foreignKeys };
}

function parseTablesFromSchemaSql(schemaSql: string) {
  const tables: MigrationTable[] = [];
  const pattern = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(schemaSql)) !== null) {
    const tableName = match[1];
    if (EXCLUDED_TABLES.has(tableName)) {
      continue;
    }

    const statementStart = match.index;
    let statementEnd = schemaSql.indexOf(";\n", statementStart);
    if (statementEnd === -1) {
      statementEnd = schemaSql.indexOf(";", statementStart);
    }
    if (statementEnd === -1) {
      statementEnd = schemaSql.length;
    }

    const createTableSql = schemaSql.slice(statementStart, statementEnd);
    const { columns, foreignKeys } = parseColumnsFromCreateTableSql(createTableSql);
    tables.push({
      name: tableName,
      columns,
      foreignKeys,
      hasCompanyId: columns.some((column) => column.name === "company_id"),
      primaryKeyColumns: columns.filter((column) => column.primaryKey).map((column) => column.name),
    });
  }

  return tables;
}

async function readTablesFromDatabase(db: AppDatabase) {
  const rows = await db.all<{ name: string; sql: string | null }>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
  );

  return rows
    .filter((row) => row.sql && !EXCLUDED_TABLES.has(row.name))
    .map((row) => {
      const { columns, foreignKeys } = parseColumnsFromCreateTableSql(row.sql as string);
      return {
        name: row.name,
        columns,
        foreignKeys,
        hasCompanyId: columns.some((column) => column.name === "company_id"),
        primaryKeyColumns: columns.filter((column) => column.primaryKey).map((column) => column.name),
      } satisfies MigrationTable;
    });
}

function buildPackageMetadataColumns(): PackageMetadataColumn[] {
  return [
    { name: "package_key", type: "TEXT", nullable: false, primaryKey: false, example: MIGRATION_PACKAGE_KEY },
    { name: "package_version", type: "INTEGER", nullable: false, primaryKey: false, example: MIGRATION_PACKAGE_VERSION },
    { name: "exported_at", type: "TEXT", nullable: false, primaryKey: false, example: "2026-01-01T00:00:00.000Z" },
    { name: "source_schema_hash", type: "TEXT", nullable: false, primaryKey: false, example: "sha256:..." },
    { name: "schema_json", type: "TEXT", nullable: false, primaryKey: false, example: "{\"format\":{...}}" },
    { name: "original_company_id", type: "TEXT", nullable: false, primaryKey: false, example: "company_uuid" },
    { name: "name", type: "TEXT", nullable: false, primaryKey: false, example: "Example Company" },
    { name: "api_key_hash", type: "TEXT", nullable: true, primaryKey: false, example: null },
    { name: "api_key_created_at", type: "TEXT", nullable: true, primaryKey: false, example: null },
    { name: "tablet_code_value", type: "TEXT", nullable: true, primaryKey: false, example: null },
    { name: "tablet_code_hash", type: "TEXT", nullable: true, primaryKey: false, example: null },
    { name: "tablet_code_updated_at", type: "TEXT", nullable: true, primaryKey: false, example: null },
    { name: "created_at", type: "TEXT", nullable: false, primaryKey: false, example: "2026-01-01T00:00:00.000Z" },
  ];
}

function inferExampleValue(column: MigrationColumn): string | number | null {
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();

  if (name === "company_id") return "company_uuid";
  if (name.endsWith("_id") || column.primaryKey) return 1;
  if (name.includes("date") && !name.includes("updated")) return "2026-01-01";
  if (name.includes("time")) return "09:00";
  if (name.includes("email")) return "name@example.com";
  if (name.startsWith("is_") || name.startsWith("has_") || name.endsWith("_enabled")) return 1;
  if (type.includes("int") || type.includes("real") || type.includes("numeric")) return 1;
  if (name.includes("json")) return "{}";
  if (column.nullable) return null;
  return `${column.name}_value`;
}

function buildIncludedTableOrder(tables: MigrationTable[]) {
  const selected = new Set<string>(tables.filter((table) => table.hasCompanyId).map((table) => table.name));
  let changed = true;

  while (changed) {
    changed = false;
    for (const table of tables) {
      if (selected.has(table.name)) {
        continue;
      }
      if (table.foreignKeys.some((foreignKey) => selected.has(foreignKey.referencedTable))) {
        selected.add(table.name);
        changed = true;
      }
    }
  }

  const selectedTables = tables.filter((table) => selected.has(table.name));
  const inDegree = new Map(selectedTables.map((table) => [table.name, 0]));
  const childrenByParent = new Map<string, Set<string>>();

  for (const table of selectedTables) {
    for (const foreignKey of table.foreignKeys) {
      if (!selected.has(foreignKey.referencedTable)) {
        continue;
      }
      const children = childrenByParent.get(foreignKey.referencedTable) ?? new Set<string>();
      children.add(table.name);
      childrenByParent.set(foreignKey.referencedTable, children);
      inDegree.set(table.name, (inDegree.get(table.name) ?? 0) + 1);
    }
  }

  const queue = selectedTables
    .filter((table) => (inDegree.get(table.name) ?? 0) === 0)
    .map((table) => table.name)
    .sort((left, right) => left.localeCompare(right));
  const order: string[] = [];

  while (queue.length > 0) {
    const tableName = queue.shift() as string;
    order.push(tableName);
    const children = [...(childrenByParent.get(tableName) ?? [])].sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      const nextInDegree = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(child);
      }
    }
  }

  if (order.length !== selectedTables.length) {
    throw new HTTPException(500, { message: "Could not resolve migration table import order" });
  }

  return order.map((tableName) => selectedTables.find((table) => table.name === tableName) as MigrationTable);
}

function buildPackageSchemaDocument(tables: MigrationTable[]) {
  const orderedTables = buildIncludedTableOrder(tables);

  return {
    format: {
      key: MIGRATION_PACKAGE_KEY,
      version: MIGRATION_PACKAGE_VERSION,
      encoding: "UTF-8",
      singleFile: true,
      fileExtension: ".sqlite",
      packageTableName: MIGRATION_METADATA_TABLE,
      schemaSource: "backend/db/schema.ts",
      systemSchemaSource: "backend/db/schema.ts",
    },
    packageMetadata: {
      tableName: MIGRATION_METADATA_TABLE,
      description: "Single-row metadata that anchors the SQLite migration file and documents the generated schema.",
      columns: buildPackageMetadataColumns(),
    },
    tables: orderedTables.map((table) => ({
      tableName: table.name,
      importOrder: orderedTables.findIndex((entry) => entry.name === table.name) + 1,
      rowScope: table.hasCompanyId
        ? "Rows where company_id matches the target company."
        : "Rows linked through foreign keys to already selected company-scoped parent rows.",
      columns: table.columns.map((column) => ({
        ...column,
        example: inferExampleValue(column),
        foreignKey: table.foreignKeys.find((foreignKey) => foreignKey.column === column.name) ?? null,
      })),
    })),
    notes: [
      "The exported package is a single SQLite file.",
      "The schema document is generated from the live company schema and stored in the file metadata.",
      "company_id columns are rewritten to the target company during import.",
      "Import fully replaces the target company database before rows are inserted.",
      "The package is self-describing: it carries both schema JSON and a schema hash.",
    ],
  };
}

function buildSchemaHash(schemaDocument: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(schemaDocument)).digest("hex");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

function buildOrderByClause(table: MigrationTable) {
  const preferredColumns =
    table.primaryKeyColumns.length > 0 ? table.primaryKeyColumns : table.columns.slice(0, 1).map((column) => column.name);
  return preferredColumns.length > 0 ? ` ORDER BY ${preferredColumns.map((column) => quoteIdentifier(column)).join(", ")}` : "";
}

function rowMatchesParentSelection(
  table: MigrationTable,
  row: Record<string, unknown>,
  selectedParentKeys: Map<string, Set<string>>,
) {
  const relevantForeignKeys = table.foreignKeys.filter((foreignKey) => selectedParentKeys.has(foreignKey.referencedTable));
  if (relevantForeignKeys.length === 0) {
    return true;
  }

  return relevantForeignKeys.every((foreignKey) => {
    const selectedKeys = selectedParentKeys.get(foreignKey.referencedTable);
    if (!selectedKeys) {
      return true;
    }
    return selectedKeys.has(String(row[foreignKey.column] ?? ""));
  });
}

function toKey(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

async function openSqlitePackageDatabase(buffer: Buffer): Promise<BetterSqliteDatabase> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(buffer);
  db.pragma("foreign_keys = ON");
  return db as unknown as BetterSqliteDatabase;
}

async function createInMemoryPackageDatabase(): Promise<BetterSqliteDatabase> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = MEMORY");
  db.pragma("synchronous = OFF");
  db.exec(PACKAGE_SCHEMA_SQL);
  return db as unknown as BetterSqliteDatabase;
}

async function readUploadedPackage(file: File) {
  if (!file.name.toLowerCase().endsWith(".sqlite")) {
    throw new HTTPException(400, { message: "SQLite migration files must use the .sqlite extension" });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) {
    throw new HTTPException(400, { message: "SQLite migration file is empty" });
  }

  return openSqlitePackageDatabase(Buffer.from(bytes));
}

async function loadMigrationTables(db: AppDatabase) {
  return buildIncludedTableOrder(await readTablesFromDatabase(db));
}

async function exportTableRows(db: AppDatabase, table: MigrationTable, companyId: string, selectedParentKeys: Map<string, Set<string>>) {
  const columnNames = table.columns.map((column) => column.name);
  const sql =
    `SELECT ${columnNames.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}` +
    (table.hasCompanyId ? ` WHERE ${quoteIdentifier("company_id")} = ?` : "") +
    buildOrderByClause(table);
  const rows = await db.all<Record<string, unknown>>(sql, table.hasCompanyId ? [companyId] : []);
  const filteredRows = table.hasCompanyId ? rows : rows.filter((row) => rowMatchesParentSelection(table, row, selectedParentKeys));

  if (table.primaryKeyColumns.length === 1) {
    selectedParentKeys.set(
      table.name,
      new Set(filteredRows.map((row) => toKey(row[table.primaryKeyColumns[0]]))),
    );
  }

  return filteredRows;
}

async function clearImportedTables(db: AppDatabase, orderedTables: MigrationTable[]) {
  const statements = orderedTables
    .slice()
    .reverse()
    .map((table) => ({ sql: `DELETE FROM ${quoteIdentifier(table.name)}` }));

  for (let index = 0; index < statements.length; index += 25) {
    await db.batch(statements.slice(index, index + 25));
  }
}

async function runInTransaction(db: AppDatabase, work: () => Promise<void>) {
  await db.exec("BEGIN IMMEDIATE");
  try {
    await work();
    await db.exec("COMMIT");
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors and rethrow the original failure.
    }
    throw error;
  }
}

async function importTableData(
  db: AppDatabase,
  orderedTables: MigrationTable[],
  packageDb: BetterSqliteDatabase,
  targetCompanyId: string,
) {
  for (const table of orderedTables) {
    const expectedHeaders = table.columns.map((column) => column.name);
    const tableInfo = packageDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all() as Array<{ name: string }>;
    const packageHeaders = tableInfo.map((row) => row.name);
    if (packageHeaders.join(",") !== expectedHeaders.join(",")) {
      throw new HTTPException(400, { message: `Invalid table layout for ${table.name}` });
    }

    const rows = packageDb.prepare(
      `SELECT ${expectedHeaders.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}${buildOrderByClause(table)}`,
    ).all() as Array<Record<string, unknown>>;

    const statements = rows.map((row) => ({
      sql: `INSERT INTO ${quoteIdentifier(table.name)} (${expectedHeaders.map(quoteIdentifier).join(", ")}) VALUES (${expectedHeaders.map(() => "?").join(", ")})`,
      params: table.columns.map((column) => (column.name === "company_id" ? targetCompanyId : (row[column.name] ?? null))) as SqlValue[],
    }));

    for (let index = 0; index < statements.length; index += 250) {
      const chunk = statements.slice(index, index + 250);
      if (chunk.length > 0) {
        await db.batch(chunk);
      }
    }
  }
}

function readMigrationMetadata(packageDb: BetterSqliteDatabase) {
  const metadata = packageDb.prepare(
    `SELECT
      package_key,
      package_version,
      exported_at,
      source_schema_hash,
      schema_json,
      original_company_id,
      name,
      api_key_hash,
      api_key_created_at,
      tablet_code_value,
      tablet_code_hash,
      tablet_code_updated_at,
      created_at
     FROM ${quoteIdentifier(MIGRATION_METADATA_TABLE)}
     LIMIT 1`,
  ).get() as
    | {
        package_key: string;
        package_version: number;
        exported_at: string;
        source_schema_hash: string;
        schema_json: string;
        original_company_id: string;
        name: string;
        api_key_hash: string | null;
        api_key_created_at: string | null;
        tablet_code_value: string | null;
        tablet_code_hash: string | null;
        tablet_code_updated_at: string | null;
        created_at: string;
      }
    | null;

  if (!metadata) {
    throw new HTTPException(400, { message: "SQLite migration package is missing package metadata" });
  }

  return metadata;
}

async function validatePackageDatabaseSchema(packageDb: BetterSqliteDatabase, orderedTables: MigrationTable[]) {
  for (const table of orderedTables) {
    const expectedHeaders = table.columns.map((column) => column.name);
    const tableInfo = packageDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all() as Array<{ name: string }>;
    const packageHeaders = tableInfo.map((row) => row.name);
    if (packageHeaders.join(",") !== expectedHeaders.join(",")) {
      throw new HTTPException(400, { message: `SQLite migration package table mismatch: ${table.name}` });
    }
  }
}

export const adminSqliteMigrationService = {
  async getSchema() {
    const tables = parseTablesFromSchemaSql(companySchema);
    const schema = buildPackageSchemaDocument(tables);
    return schema;
  },

  async exportCompany(systemDb: AppDatabase, companyDb: AppDatabase, companyId: string) {
    const company = await systemDb.first<{
      name: string;
      api_key_hash: string | null;
      api_key_created_at: string | null;
      tablet_code_value: string | null;
      tablet_code_hash: string | null;
      tablet_code_updated_at: string | null;
      created_at: string;
    }>(
      `SELECT
        name,
        api_key_hash,
        api_key_created_at,
        tablet_code_value,
        tablet_code_hash,
        tablet_code_updated_at,
        created_at
       FROM companies
       WHERE id = ?`,
      [companyId],
    );

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const orderedTables = await loadMigrationTables(companyDb);
    const schemaDocument = buildPackageSchemaDocument(orderedTables);
    const schemaJson = JSON.stringify(schemaDocument);
    const sourceSchemaHash = buildSchemaHash(schemaDocument);
    const packageDb = await createInMemoryPackageDatabase();

    packageDb.prepare(
      `INSERT INTO ${quoteIdentifier(MIGRATION_METADATA_TABLE)} (
        package_key,
        package_version,
        exported_at,
        source_schema_hash,
        schema_json,
        original_company_id,
        name,
        api_key_hash,
        api_key_created_at,
        tablet_code_value,
        tablet_code_hash,
        tablet_code_updated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      MIGRATION_PACKAGE_KEY,
      MIGRATION_PACKAGE_VERSION,
      new Date().toISOString(),
      sourceSchemaHash,
      schemaJson,
      companyId,
      company.name,
      company.api_key_hash,
      company.api_key_created_at,
      company.tablet_code_value,
      company.tablet_code_hash,
      company.tablet_code_updated_at,
      company.created_at,
    );

    const selectedParentKeys = new Map<string, Set<string>>();
    for (const table of orderedTables) {
      const rows = await exportTableRows(companyDb, table, companyId, selectedParentKeys);
      if (rows.length === 0) {
        continue;
      }

      const columnNames = table.columns.map((column) => column.name);
      const insert = packageDb.prepare(
        `INSERT INTO ${quoteIdentifier(table.name)} (${columnNames.map(quoteIdentifier).join(", ")}) VALUES (${columnNames.map(() => "?").join(", ")})`,
      );
      const writeRows = packageDb.transaction((tableRows: Array<Record<string, unknown>>) => {
        for (const row of tableRows) {
          insert.run(...columnNames.map((column) => row[column] ?? null));
        }
      });
      writeRows(rows);
    }

    const packageName = `${slugify(company.name)}-migration`;
    const fileBuffer = packageDb.serialize();

    return {
      packageName,
      fileName: `${packageName}.sqlite`,
      contentType: SQLITE_CONTENT_TYPE,
      exportedAt: new Date().toISOString(),
      fileBase64: fileBuffer.toString("base64"),
    };
  },

  async createCompanyFromSQLite(
    systemDb: AppDatabase,
    companyDb: AppDatabase,
    input: { file: File; name?: string },
    companyId = crypto.randomUUID(),
  ) {
    const packageDb = await readUploadedPackage(input.file);
    const orderedTables = await loadMigrationTables(companyDb);
    const schemaDocument = buildPackageSchemaDocument(orderedTables);
    const expectedHash = buildSchemaHash(schemaDocument);
    const metadata = readMigrationMetadata(packageDb);

    if (metadata.package_key !== MIGRATION_PACKAGE_KEY || metadata.package_version !== MIGRATION_PACKAGE_VERSION) {
      throw new HTTPException(400, { message: "Unsupported SQLite migration package version" });
    }

    if (metadata.source_schema_hash !== expectedHash) {
      throw new HTTPException(400, { message: "SQLite migration package schema does not match the current company schema" });
    }

    if (metadata.schema_json) {
      const packageSchema = JSON.parse(metadata.schema_json) as unknown;
      if (buildSchemaHash(packageSchema) !== expectedHash) {
        throw new HTTPException(400, { message: "SQLite migration package schema document is invalid" });
      }
    }

    const companyName = input.name?.trim() || metadata.name.trim();
    if (!companyName) {
      throw new HTTPException(400, { message: "Company name is required" });
    }

    const existing = await systemService.getCompanyByName(systemDb, companyName);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    await systemDb.run(
      `INSERT INTO companies (
        id,
        name,
        api_key_hash,
        api_key_created_at,
        tablet_code_value,
        tablet_code_hash,
        tablet_code_updated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        companyName,
        metadata.api_key_hash,
        metadata.api_key_created_at,
        metadata.tablet_code_value,
        metadata.tablet_code_hash,
        metadata.tablet_code_updated_at,
        metadata.created_at,
      ],
    );

    try {
      await runInTransaction(companyDb, async () => {
        const liveOrderedTables = await loadMigrationTables(companyDb);
        await clearImportedTables(companyDb, liveOrderedTables);
        await validatePackageDatabaseSchema(packageDb, liveOrderedTables);
        await importTableData(companyDb, liveOrderedTables, packageDb, companyId);
      });
    } catch (error) {
      await systemDb.run("DELETE FROM companies WHERE id = ?", [companyId]);
      throw error;
    }

    return systemService.getCompanyById(systemDb, companyId);
  },

  async replaceCompanyFromSQLite(
    systemDb: AppDatabase,
    companyDb: AppDatabase,
    input: { companyId: string; companyName?: string; file: File },
  ) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const packageDb = await readUploadedPackage(input.file);
    const orderedTables = await loadMigrationTables(companyDb);
    const schemaDocument = buildPackageSchemaDocument(orderedTables);
    const expectedHash = buildSchemaHash(schemaDocument);
    const metadata = readMigrationMetadata(packageDb);

    if (metadata.package_key !== MIGRATION_PACKAGE_KEY || metadata.package_version !== MIGRATION_PACKAGE_VERSION) {
      throw new HTTPException(400, { message: "Unsupported SQLite migration package version" });
    }

    if (metadata.source_schema_hash !== expectedHash) {
      throw new HTTPException(400, { message: "SQLite migration package schema does not match the current company schema" });
    }

    if (metadata.schema_json) {
      const packageSchema = JSON.parse(metadata.schema_json) as unknown;
      if (buildSchemaHash(packageSchema) !== expectedHash) {
        throw new HTTPException(400, { message: "SQLite migration package schema document is invalid" });
      }
    }

    const targetName = input.companyName?.trim() || metadata.name.trim() || company.name;
    const existingByName = await systemService.getCompanyByName(systemDb, targetName);
    if (existingByName && existingByName.id !== input.companyId) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    await runInTransaction(companyDb, async () => {
      const liveOrderedTables = await loadMigrationTables(companyDb);
      await clearImportedTables(companyDb, liveOrderedTables);
      await validatePackageDatabaseSchema(packageDb, liveOrderedTables);
      await importTableData(companyDb, liveOrderedTables, packageDb, input.companyId);
    });

    await systemDb.run(
      `UPDATE companies
       SET
         name = ?,
         api_key_hash = ?,
         api_key_created_at = ?,
         tablet_code_value = ?,
         tablet_code_hash = ?,
         tablet_code_updated_at = ?,
         created_at = ?
       WHERE id = ?`,
      [
        targetName,
        metadata.api_key_hash,
        metadata.api_key_created_at,
        metadata.tablet_code_value,
        metadata.tablet_code_hash,
        metadata.tablet_code_updated_at,
        metadata.created_at,
        input.companyId,
      ],
    );

    return systemService.getCompanyById(systemDb, input.companyId);
  },
};

