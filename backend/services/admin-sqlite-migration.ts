import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  primaryKeyColumns: string[];
};

type PackageMetadataColumn = MigrationColumn & {
  example: string | number | null;
};

type MigrationImportSeverity = "error" | "warning";

type MigrationImportProblem = {
  severity: MigrationImportSeverity;
  stage:
    | "file"
    | "metadata"
    | "schema"
    | "layout"
    | "validation"
    | "import"
    | "company";
  table?: string | null;
  rowId?: number | string | null;
  column?: string | null;
  message: string;
  details?: unknown;
};

type MigrationImportReport = {
  success: boolean;
  packageKey: string | null;
  packageVersion: number | null;
  packageName: string | null;
  originalCompanyId: string | null;
  expectedSchemaHash: string;
  packageSchemaHash: string | null;
  companyName: string | null;
  tableCount: number;
  rowCount: number;
  warnings: MigrationImportProblem[];
  errors: MigrationImportProblem[];
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
  close(): void;
};

function coerceSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return String(value);
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

const COLUMN_CONSTRAINT_KEYWORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "NOT",
  "NULL",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "COLLATE",
  "REFERENCES",
  "GENERATED",
  "AS",
  "AUTOINCREMENT",
  "ON",
  "UPDATE",
  "DELETE",
]);

function extractColumnType(rest: string) {
  const tokens = rest.trim().match(/[^\s]+/g) ?? [];
  const typeTokens: string[] = [];

  for (const token of tokens) {
    const normalized = token.toUpperCase();
    if (typeTokens.length > 0 && COLUMN_CONSTRAINT_KEYWORDS.has(normalized)) {
      break;
    }
    typeTokens.push(token);
  }

  return typeTokens.join(" ").trim() || "TEXT";
}

function getPackageColumns(table: MigrationTable) {
  return table.columns;
}

function buildPackageTableSql(table: MigrationTable) {
  const packageColumns = getPackageColumns(table);
  const columnDefinitions = packageColumns.map((column) => {
    const segments = [quoteIdentifier(column.name), column.type];
    if (!column.nullable) {
      segments.push("NOT NULL");
    }
    if (column.primaryKey) {
      segments.push("PRIMARY KEY");
    }
    return segments.join(" ");
  });

  const foreignKeys = table.foreignKeys
    .map((foreignKey) =>
      `FOREIGN KEY (${quoteIdentifier(foreignKey.column)}) REFERENCES ${quoteIdentifier(foreignKey.referencedTable)} (${quoteIdentifier(foreignKey.referencedColumn)})`,
    );

  const body = [...columnDefinitions, ...foreignKeys].join(",\n  ");
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (\n  ${body}\n);`;
}

function buildPackageMetadataTableSql() {
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(MIGRATION_METADATA_TABLE)} (
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
}

function buildPackageSchemaSql(tables: MigrationTable[]) {
  return [
    ...tables.map((table) => buildPackageTableSql(table)),
    buildPackageMetadataTableSql(),
  ].join("\n\n");
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
    const normalizedRest = rest.toUpperCase();
    columns.push({
      name: match.groups.name,
      type: extractColumnType(rest),
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
  const selectedTables = tables.slice();
  const selected = new Set<string>(selectedTables.map((table) => table.name));
  const inDegree = new Map(selectedTables.map((table) => [table.name, 0]));
  const childrenByParent = new Map<string, Set<string>>();

  for (const table of selectedTables) {
    for (const foreignKey of table.foreignKeys) {
      if (!selected.has(foreignKey.referencedTable)) continue;
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
      rowScope: "Rows are stored directly in the package tables and linked through foreign keys.",
      columns: getPackageColumns(table).map((column) => ({
        ...column,
        example: inferExampleValue(column),
        foreignKey: table.foreignKeys.find((foreignKey) => foreignKey.column === column.name) ?? null,
      })),
    })),
    notes: [
      "The exported package is a single SQLite file.",
      "The schema document is generated from the live company schema and stored in the file metadata.",
      "Import fully replaces the target company database before rows are inserted.",
      "The package is self-describing: it carries both schema JSON and a schema hash.",
    ],
  };
}

function buildSchemaHash(schemaDocument: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalizeSchemaDocument(schemaDocument))).digest("hex");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

function createImportProblem(problem: MigrationImportProblem) {
  return {
    severity: problem.severity,
    stage: problem.stage,
    table: problem.table ?? null,
    rowId: problem.rowId ?? null,
    column: problem.column ?? null,
    message: problem.message,
    details: problem.details ?? null,
  };
}

function buildEmptyImportReport(expectedSchemaHash: string, companyName: string | null): MigrationImportReport {
  return {
    success: false,
    packageKey: null,
    packageVersion: null,
    packageName: null,
    originalCompanyId: null,
    expectedSchemaHash,
    packageSchemaHash: null,
    companyName,
    tableCount: 0,
    rowCount: 0,
    warnings: [],
    errors: [],
  };
}

function buildOrderByClause(table: MigrationTable) {
  const preferredColumns =
    table.primaryKeyColumns.length > 0 ? table.primaryKeyColumns : table.columns.slice(0, 1).map((column) => column.name);
  return preferredColumns.length > 0 ? ` ORDER BY ${preferredColumns.map((column) => quoteIdentifier(column)).join(", ")}` : "";
}

async function openSqlitePackageDatabase(filePath: string): Promise<BetterSqliteDatabase> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  db.pragma("foreign_keys = ON");
  return db as unknown as BetterSqliteDatabase;
}

async function createInMemoryPackageDatabase(tables: MigrationTable[]): Promise<BetterSqliteDatabase> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = MEMORY");
  db.pragma("synchronous = OFF");
  db.exec(buildPackageSchemaSql(tables));
  db.exec(buildPackageMetadataTableSql());
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

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jtzt-sqlite-import-"));
  const tempPath = path.join(tempDir, "package.sqlite");
  await fs.writeFile(tempPath, bytes);

  try {
    const db = await openSqlitePackageDatabase(tempPath);
    return {
      db,
      async cleanup() {
        try {
          db.close();
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function loadMigrationTables(db: AppDatabase) {
  return buildIncludedTableOrder(await readTablesFromDatabase(db));
}

async function exportTableRows(db: AppDatabase, table: MigrationTable) {
  const columnNames = getPackageColumns(table).map((column) => column.name);
  const sql = `SELECT ${columnNames.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}${buildOrderByClause(table)}`;
  const rows = await db.all<Record<string, unknown>>(sql, []);
  return rows;
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
) {
  for (const table of orderedTables) {
    const expectedHeaders = getPackageColumns(table).map((column) => column.name);
    const liveHeaders = table.columns.map((column) => column.name);
    const tableInfo = packageDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all() as Array<{ name: string }>;
    const packageHeaders = tableInfo.map((row) => row.name);
    if (packageHeaders.join(",") !== expectedHeaders.join(",")) {
      throw new HTTPException(400, { message: `Invalid table layout for ${table.name}` });
    }

    const rows = packageDb.prepare(
      `SELECT ${expectedHeaders.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}${buildOrderByClause(table)}`,
    ).all() as Array<Record<string, unknown>>;

    const statements = rows.map((row) => ({
      sql: `INSERT INTO ${quoteIdentifier(table.name)} (${liveHeaders.map(quoteIdentifier).join(", ")}) VALUES (${liveHeaders.map(() => "?").join(", ")})`,
      params: liveHeaders.map((column) => (row[column] ?? null)) as SqlValue[],
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

function parseReportableJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

type SchemaColumnLike = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  example?: string | number | null;
  foreignKey?: {
    column: string;
    referencedTable: string;
    referencedColumn: string;
  } | null;
};

type SchemaTableLike = {
  tableName: string;
  importOrder?: number;
  rowScope?: string;
  columns: SchemaColumnLike[];
};

type IndexedSchemaTableLike = SchemaTableLike & { __index: number };

type SchemaDocumentLike = {
  format?: Record<string, unknown>;
  packageMetadata?: Record<string, unknown>;
  tables: SchemaTableLike[];
  notes?: unknown[];
};

type SchemaDiffEntry = {
  path: string;
  expected: unknown;
  actual: unknown;
};

function isSchemaDocument(value: unknown): value is { tables: SchemaTableLike[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { tables?: unknown }).tables),
  );
}

function diffValues(expected: unknown, actual: unknown, path = "$", entries: SchemaDiffEntry[] = []): SchemaDiffEntry[] {
  if (Object.is(expected, actual)) {
    return entries;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}[${index}]`;
      if (index >= expected.length) {
        entries.push({ path: childPath, expected: undefined, actual: actual[index] });
        continue;
      }
      if (index >= actual.length) {
        entries.push({ path: childPath, expected: expected[index], actual: undefined });
        continue;
      }
      diffValues(expected[index], actual[index], childPath, entries);
    }
    return entries;
  }

  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedKeys = Object.keys(expected as Record<string, unknown>);
    const actualKeys = Object.keys(actual as Record<string, unknown>);
    const keys = new Set([...expectedKeys, ...actualKeys]);
    for (const key of keys) {
      const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
      const expectedValue = (expected as Record<string, unknown>)[key];
      const actualValue = (actual as Record<string, unknown>)[key];
      if (!(key in (expected as Record<string, unknown>))) {
        entries.push({ path: childPath, expected: undefined, actual: actualValue });
        continue;
      }
      if (!(key in (actual as Record<string, unknown>))) {
        entries.push({ path: childPath, expected: expectedValue, actual: undefined });
        continue;
      }
      diffValues(expectedValue, actualValue, childPath, entries);
    }
    return entries;
  }

  entries.push({ path, expected, actual });
  return entries;
}

function compareSchemaDocuments(expected: unknown, actual: unknown) {
  if (!isSchemaDocument(expected) || !isSchemaDocument(actual)) {
    return {
      expectedTableCount: null,
      actualTableCount: null,
      expectedTableOrder: [] as string[],
      actualTableOrder: [] as string[],
      missingTables: [] as string[],
      extraTables: [] as string[],
      tableDiffs: [] as Array<Record<string, unknown>>,
      structuralDiffs: [] as SchemaDiffEntry[],
    };
  }

  const expectedTables = expected.tables;
  const actualTables = actual.tables;
  const expectedTableNames = expectedTables.map((table) => table.tableName);
  const actualTableNames = actualTables.map((table) => table.tableName);
  const expectedTablesByName = new Map<string, IndexedSchemaTableLike>(
    expectedTables.map((table, index) => [table.tableName, { ...table, __index: index }]),
  );
  const actualTablesByName = new Map<string, IndexedSchemaTableLike>(
    actualTables.map((table, index) => [table.tableName, { ...table, __index: index }]),
  );
  const missingTables = expectedTableNames.filter((tableName) => !actualTablesByName.has(tableName));
  const extraTables = actualTableNames.filter((tableName) => !expectedTablesByName.has(tableName));
  const tableDiffs: Array<Record<string, unknown>> = [];

  for (const tableName of expectedTableNames) {
    const expectedTable = expectedTablesByName.get(tableName);
    const actualTable = actualTablesByName.get(tableName);
    if (!expectedTable || !actualTable) {
      continue;
    }

    const expectedColumns = expectedTable.columns;
    const actualColumns = actualTable.columns;
    const expectedColumnNames = expectedColumns.map((column) => column.name);
    const actualColumnNames = actualColumns.map((column) => column.name);
    const expectedColumnsByName = new Map(
      expectedColumns.map((column, index) => [column.name, { ...column, __index: index }]),
    );
    const actualColumnsByName = new Map(
      actualColumns.map((column, index) => [column.name, { ...column, __index: index }]),
    );
    const missingColumns = expectedColumnNames.filter((columnName) => !actualColumnsByName.has(columnName));
    const extraColumns = actualColumnNames.filter((columnName) => !expectedColumnsByName.has(columnName));
    const changedColumns = [...expectedColumnsByName.keys()]
      .filter((columnName) => actualColumnsByName.has(columnName))
      .flatMap((columnName) => {
        const expectedColumn = expectedColumnsByName.get(columnName);
        const actualColumn = actualColumnsByName.get(columnName);
        if (!expectedColumn || !actualColumn) {
          return [];
        }

        const diffs: Record<string, unknown> = {};
        if (expectedColumn.__index !== actualColumn.__index) {
          diffs.index = { expected: expectedColumn.__index, actual: actualColumn.__index };
        }
        if (expectedColumn.type !== actualColumn.type) diffs.type = { expected: expectedColumn.type, actual: actualColumn.type };
        if (expectedColumn.nullable !== actualColumn.nullable) diffs.nullable = { expected: expectedColumn.nullable, actual: actualColumn.nullable };
        if (expectedColumn.primaryKey !== actualColumn.primaryKey) diffs.primaryKey = { expected: expectedColumn.primaryKey, actual: actualColumn.primaryKey };
        if (expectedColumn.example !== actualColumn.example) diffs.example = { expected: expectedColumn.example, actual: actualColumn.example };
        if (expectedColumn.foreignKey !== actualColumn.foreignKey) {
          const expectedForeignKey = expectedColumn.foreignKey ?? null;
          const actualForeignKey = actualColumn.foreignKey ?? null;
          if (JSON.stringify(expectedForeignKey) !== JSON.stringify(actualForeignKey)) {
            diffs.foreignKey = { expected: expectedForeignKey, actual: actualForeignKey };
          }
        }

        return Object.keys(diffs).length > 0 ? [{ column: columnName, ...diffs }] : [];
      });

    const tableStructuralDiffs = diffValues(
      {
        tableName: expectedTable.tableName,
        importOrder: expectedTable.importOrder,
        rowScope: expectedTable.rowScope,
        columns: expectedColumns.map((column) => ({
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          example: column.example ?? null,
          foreignKey: column.foreignKey ?? null,
        })),
      },
      {
        tableName: actualTable.tableName,
        importOrder: actualTable.importOrder,
        rowScope: actualTable.rowScope,
        columns: actualColumns.map((column) => ({
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          example: column.example ?? null,
          foreignKey: column.foreignKey ?? null,
        })),
      },
      `$.tables[${expectedTable.__index}]`,
      [],
    );

    if (missingColumns.length > 0 || extraColumns.length > 0 || changedColumns.length > 0) {
      tableDiffs.push({
        tableName,
        expectedIndex: expectedTable.__index,
        actualIndex: actualTable.__index,
        missingColumns,
        extraColumns,
        changedColumns,
      });
    } else if (tableStructuralDiffs.length > 0) {
      tableDiffs.push({
        tableName,
        expectedIndex: expectedTable.__index,
        actualIndex: actualTable.__index,
        structuralDiffs: tableStructuralDiffs,
      });
    }
  }

  return {
    expectedTableCount: expectedTables.length,
    actualTableCount: actualTables.length,
    expectedTableOrder: expectedTableNames,
    actualTableOrder: actualTableNames,
    missingTables,
    extraTables,
    tableDiffs,
    structuralDiffs: diffValues(
      {
        format: (expected as Record<string, unknown>).format,
        packageMetadata: (expected as Record<string, unknown>).packageMetadata,
        notes: (expected as Record<string, unknown>).notes,
        tables: expectedTables,
      },
      {
        format: (actual as Record<string, unknown>).format,
        packageMetadata: (actual as Record<string, unknown>).packageMetadata,
        notes: (actual as Record<string, unknown>).notes,
        tables: actualTables,
      },
    ),
  };
}

function canonicalizeSchemaDocument(schemaDocument: unknown) {
  if (!isSchemaDocument(schemaDocument)) {
    return schemaDocument;
  }

  const document = schemaDocument as SchemaDocumentLike;
  return {
    format: document.format ? Object.fromEntries(Object.entries(document.format).sort(([left], [right]) => left.localeCompare(right))) : undefined,
    packageMetadata: document.packageMetadata
      ? Object.fromEntries(Object.entries(document.packageMetadata).sort(([left], [right]) => left.localeCompare(right)))
      : undefined,
    tables: [...document.tables]
      .map((table) => ({
        tableName: table.tableName,
        rowScope: table.rowScope ?? null,
        columns: [...table.columns]
          .map((column) => ({
            name: column.name,
            type: column.type,
            nullable: column.nullable,
            primaryKey: column.primaryKey,
            example: column.example ?? null,
            foreignKey: column.foreignKey ?? null,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.tableName.localeCompare(right.tableName)),
    notes: Array.isArray(document.notes) ? [...document.notes] : undefined,
  };
}

async function buildImportReport(
  packageDb: BetterSqliteDatabase,
  orderedTables: MigrationTable[],
  expectedSchemaHash: string,
  expectedSchemaDocument: unknown,
  companyName: string | null,
) {
  const report = buildEmptyImportReport(expectedSchemaHash, companyName);
  report.tableCount = orderedTables.length;

  let metadata: ReturnType<typeof readMigrationMetadata> | null = null;
  try {
    metadata = readMigrationMetadata(packageDb);
    report.packageKey = metadata.package_key;
    report.packageVersion = metadata.package_version;
    report.packageName = metadata.name;
    report.originalCompanyId = metadata.original_company_id;

    if (metadata.package_key !== MIGRATION_PACKAGE_KEY) {
      report.errors.push(createImportProblem({
        severity: "error",
        stage: "metadata",
        message: "Unsupported SQLite migration package key",
        details: { expected: MIGRATION_PACKAGE_KEY, actual: metadata.package_key },
      }));
    }

    if (metadata.package_version !== MIGRATION_PACKAGE_VERSION) {
      report.errors.push(createImportProblem({
        severity: "error",
        stage: "metadata",
        message: "Unsupported SQLite migration package version",
        details: { expected: MIGRATION_PACKAGE_VERSION, actual: metadata.package_version },
      }));
    }

    if (metadata.schema_json) {
      const parsedSchema = parseReportableJson(metadata.schema_json);
      if (!parsedSchema) {
        report.errors.push(createImportProblem({
          severity: "error",
          stage: "metadata",
          message: "Migration schema JSON is not valid JSON",
        }));
      } else if (buildSchemaHash(parsedSchema) !== expectedSchemaHash) {
        report.packageSchemaHash = buildSchemaHash(parsedSchema);
        report.errors.push(createImportProblem({
          severity: "error",
          stage: "metadata",
          message: "Migration schema JSON does not match the current company schema",
          details: {
            expectedSchemaHash,
            packageSchemaHash: report.packageSchemaHash,
            diff: compareSchemaDocuments(expectedSchemaDocument, parsedSchema),
          },
        }));
      } else {
        report.packageSchemaHash = buildSchemaHash(parsedSchema);
      }
    } else {
      report.errors.push(createImportProblem({
        severity: "error",
        stage: "metadata",
        message: "SQLite migration package is missing schema JSON",
      }));
    }

    if (metadata.source_schema_hash !== expectedSchemaHash) {
      report.packageSchemaHash = metadata.source_schema_hash;
      report.errors.push(createImportProblem({
        severity: "error",
        stage: "metadata",
        message: "SQLite migration package schema does not match the current company schema",
        details: {
          expectedSchemaHash,
          packageSchemaHash: metadata.source_schema_hash,
          diff: compareSchemaDocuments(expectedSchemaDocument, parseReportableJson(metadata.schema_json)),
        },
      }));
    }
  } catch (error) {
    report.errors.push(createImportProblem({
      severity: "error",
      stage: "file",
      message: error instanceof Error ? error.message : "SQLite migration package could not be read",
    }));
    return report;
  }

  for (const table of orderedTables) {
    try {
      const expectedHeaders = getPackageColumns(table).map((column) => column.name);
      const tableInfo = packageDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all() as Array<{ name: string; notnull: number; pk: number }>;
      const packageHeaders = tableInfo.map((row) => row.name);
      if (packageHeaders.join(",") !== expectedHeaders.join(",")) {
        report.errors.push(createImportProblem({
          severity: "error",
          stage: "layout",
          table: table.name,
          message: "SQLite migration package table layout does not match the live schema",
          details: { expected: expectedHeaders, actual: packageHeaders },
        }));
      }

      const missingColumns = expectedHeaders.filter((column) => !packageHeaders.includes(column));
      const extraColumns = packageHeaders.filter((column) => !expectedHeaders.includes(column));
      if (missingColumns.length > 0 || extraColumns.length > 0) {
        report.errors.push(createImportProblem({
          severity: "error",
          stage: "layout",
          table: table.name,
          message: "SQLite migration package table columns differ from the live schema",
          details: { missingColumns, extraColumns },
        }));
      }

      if (tableInfo.length !== table.columns.length) {
        report.warnings.push(createImportProblem({
          severity: "warning",
          stage: "layout",
          table: table.name,
          message: "SQLite metadata exposes a different number of columns than expected",
          details: { expected: table.columns.length, actual: tableInfo.length },
        }));
      }
    } catch (error) {
      report.errors.push(createImportProblem({
        severity: "error",
        stage: "layout",
        table: table.name,
        message: error instanceof Error ? error.message : "Package table is missing",
      }));
    }
  }

  const packageTableNames = packageDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all() as Array<{ name: string }>;
  const expectedTableNames = new Set(orderedTables.map((table) => table.name));
  for (const row of packageTableNames) {
    if (row.name === MIGRATION_METADATA_TABLE) {
      continue;
    }
    if (!expectedTableNames.has(row.name)) {
      report.warnings.push(createImportProblem({
        severity: "warning",
        stage: "layout",
        table: row.name,
        message: "SQLite migration package contains an extra table that will be ignored",
      }));
    }
  }

  let validationDb: BetterSqliteDatabase;
  try {
    validationDb = await createInMemoryPackageDatabase(orderedTables);
  } catch (error) {
    report.errors.push(createImportProblem({
      severity: "error",
      stage: "schema",
      message: error instanceof Error ? error.message : "Failed to construct validation database",
    }));
    return report;
  }
  let insertedRows = 0;

  try {
    const validationTables = orderedTables;
    for (const table of validationTables) {
      const expectedHeaders = getPackageColumns(table).map((column) => column.name);
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = packageDb.prepare(
          `SELECT ${expectedHeaders.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}${buildOrderByClause(table)}`,
        ).all() as Array<Record<string, unknown>>;
      } catch (error) {
        report.errors.push(createImportProblem({
          severity: "error",
          stage: "validation",
          table: table.name,
          message: error instanceof Error ? error.message : "Failed to read package rows",
        }));
        continue;
      }

      const insert = validationDb.prepare(
        `INSERT INTO ${quoteIdentifier(table.name)} (${expectedHeaders.map(quoteIdentifier).join(", ")}) VALUES (${expectedHeaders.map(() => "?").join(", ")})`,
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as Record<string, unknown>;
        try {
          const values = expectedHeaders.map((column) => coerceSqlValue(row[column]));
          insert.run(...values);
          insertedRows += 1;
        } catch (error) {
          const rowDetails = Object.fromEntries(
            expectedHeaders.map((column) => [column, coerceSqlValue(row[column])]),
          ) as Record<string, SqlValue>;
          report.errors.push(createImportProblem({
            severity: "error",
            stage: "validation",
            table: table.name,
            rowId: coerceSqlValue(row.id ?? index + 1),
            message: error instanceof Error ? error.message : "Row validation failed",
            details: rowDetails,
          }));
        }
      }
    }
  } finally {
    validationDb.close();
  }

  report.rowCount = insertedRows;
  report.success = report.errors.length === 0;
  return report;
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
    const packageDb = await createInMemoryPackageDatabase(orderedTables);

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

    for (const table of orderedTables) {
      const rows = await exportTableRows(companyDb, table);
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
    const orderedTables = await loadMigrationTables(companyDb);
    const schemaDocument = buildPackageSchemaDocument(orderedTables);
    const expectedHash = buildSchemaHash(schemaDocument);
    const companyName = input.name?.trim() || null;
    const reportBase = buildEmptyImportReport(expectedHash, companyName);
    let packageHandle: Awaited<ReturnType<typeof readUploadedPackage>> | null = null;

    try {
      packageHandle = await readUploadedPackage(input.file);
    } catch (error) {
      throw new HTTPException(400, {
        message: "SQLite migration package could not be opened",
        cause: {
          ...reportBase,
          errors: [
            createImportProblem({
              severity: "error",
              stage: "file",
              message: error instanceof Error ? error.message : "Unable to open SQLite file",
            }),
          ],
        },
      });
    }

    const packageDb = packageHandle.db;

    try {
    const report = await buildImportReport(packageDb, orderedTables, expectedHash, schemaDocument, companyName);
      const metadata = readMigrationMetadata(packageDb);

      if (report.errors.length > 0) {
        throw new HTTPException(400, {
          message: "SQLite migration package has problems",
          cause: report,
        });
      }

      const finalCompanyName = input.name?.trim() || metadata?.name.trim() || "";
      if (!finalCompanyName) {
        throw new HTTPException(400, { message: "Company name is required", cause: report });
      }

      const existing = await systemService.getCompanyByName(systemDb, finalCompanyName);
      if (existing) {
        throw new HTTPException(409, { message: "Company already exists", cause: report });
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
          finalCompanyName,
          metadata?.api_key_hash ?? null,
          metadata?.api_key_created_at ?? null,
          metadata?.tablet_code_value ?? null,
          metadata?.tablet_code_hash ?? null,
          metadata?.tablet_code_updated_at ?? null,
          metadata?.created_at ?? new Date().toISOString(),
        ],
      );

      try {
        await runInTransaction(companyDb, async () => {
          const liveOrderedTables = await loadMigrationTables(companyDb);
          await clearImportedTables(companyDb, liveOrderedTables);
          await validatePackageDatabaseSchema(packageDb, liveOrderedTables);
          await importTableData(companyDb, liveOrderedTables, packageDb);
        });
      } catch (error) {
        await systemDb.run("DELETE FROM companies WHERE id = ?", [companyId]);
        throw new HTTPException(400, {
          message: "SQLite import failed while writing to the target database",
          cause: {
            ...report,
            errors: [
              ...report.errors,
              createImportProblem({
                severity: "error",
                stage: "import",
                message: error instanceof Error ? error.message : "Unknown import failure",
              }),
            ],
          },
        });
      }

      report.success = true;
      return {
        company: await systemService.getCompanyById(systemDb, companyId),
        importReport: report,
      };
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(400, {
        message: "SQLite migration package could not be processed",
        cause: {
          ...reportBase,
          errors: [
            createImportProblem({
              severity: "error",
              stage: "file",
              message: error instanceof Error ? error.message : "Unknown import failure",
            }),
          ],
        },
      });
    } finally {
      await packageHandle?.cleanup();
    }
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

    const orderedTables = await loadMigrationTables(companyDb);
    const schemaDocument = buildPackageSchemaDocument(orderedTables);
    const expectedHash = buildSchemaHash(schemaDocument);
    const reportBase = buildEmptyImportReport(expectedHash, input.companyName?.trim() || company.name);
    let packageHandle: Awaited<ReturnType<typeof readUploadedPackage>> | null = null;

    try {
      packageHandle = await readUploadedPackage(input.file);
    } catch (error) {
      throw new HTTPException(400, {
        message: "SQLite migration package could not be opened",
        cause: {
          ...reportBase,
          errors: [
            createImportProblem({
              severity: "error",
              stage: "file",
              message: error instanceof Error ? error.message : "Unable to open SQLite file",
            }),
          ],
        },
      });
    }

    const packageDb = packageHandle.db;

    try {
      const report = await buildImportReport(packageDb, orderedTables, expectedHash, schemaDocument, input.companyName?.trim() || company.name);
      const metadata = readMigrationMetadata(packageDb);

      if (report.errors.length > 0) {
        throw new HTTPException(400, {
          message: "SQLite migration package has problems",
          cause: report,
        });
      }

      const targetName = input.companyName?.trim() || metadata.name.trim() || company.name;
      const existingByName = await systemService.getCompanyByName(systemDb, targetName);
      if (existingByName && existingByName.id !== input.companyId) {
        throw new HTTPException(409, { message: "Company already exists", cause: report });
      }

      await runInTransaction(companyDb, async () => {
        const liveOrderedTables = await loadMigrationTables(companyDb);
        await clearImportedTables(companyDb, liveOrderedTables);
        await validatePackageDatabaseSchema(packageDb, liveOrderedTables);
        await importTableData(companyDb, liveOrderedTables, packageDb);
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

      report.success = true;
      return {
        company: await systemService.getCompanyById(systemDb, input.companyId),
        importReport: report,
      };
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(400, {
        message: "SQLite migration package could not be processed",
        cause: {
          ...reportBase,
          errors: [
            createImportProblem({
              severity: "error",
              stage: "file",
              message: error instanceof Error ? error.message : "Unknown import failure",
            }),
          ],
        },
      });
    } finally {
      await packageHandle?.cleanup();
    }
  },
};

