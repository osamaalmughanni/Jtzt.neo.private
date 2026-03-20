import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { RuntimeConfig } from "../runtime/types";

type SqliteMasterEntry = {
  type: "table" | "index" | "trigger";
  name: string;
  tbl_name: string;
  sql: string | null;
};

type TableColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type RawForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
};

type ForeignKeyGroup = {
  parentTable: string;
  pairs: Array<{ from: string; to: string }>;
};

type TableSchema = {
  name: string;
  createSql: string;
  columns: TableColumn[];
  foreignKeys: ForeignKeyGroup[];
};

type SqliteSchema = {
  tables: Map<string, TableSchema>;
  indexes: SqliteMasterEntry[];
  triggers: SqliteMasterEntry[];
};

type SqliteBindValue = string | number | bigint | Buffer | null;

function ensureNodeRuntime(config: RuntimeConfig) {
  if (config.runtime !== "node") {
    throw new HTTPException(501, { message: "SQLite company transfer is only available in the Node runtime" });
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function createTempSqlitePath(prefix: string) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}.sqlite`);
}

function safeRemoveFile(filePath: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.rmSync(filePath, { force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EBUSY") {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
}

function readSchema(db: Database.Database): SqliteSchema {
  const entries = db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY
         CASE type
           WHEN 'table' THEN 0
           WHEN 'index' THEN 1
           ELSE 2
         END,
         name ASC`
    )
    .all() as SqliteMasterEntry[];

  const tables = new Map<string, TableSchema>();
  const indexes: SqliteMasterEntry[] = [];
  const triggers: SqliteMasterEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "index") {
      indexes.push(entry);
      continue;
    }
    if (entry.type === "trigger") {
      triggers.push(entry);
      continue;
    }
    if (!entry.sql) {
      continue;
    }

    const columns = db.prepare(`PRAGMA table_info(${quoteLiteral(entry.name)})`).all() as TableColumn[];
    const foreignKeyRows = db
      .prepare(`SELECT id, seq, "table", "from", "to" FROM pragma_foreign_key_list(${quoteLiteral(entry.name)}) ORDER BY id ASC, seq ASC`)
      .all() as RawForeignKeyRow[];
    const grouped = new Map<number, ForeignKeyGroup>();

    for (const foreignKeyRow of foreignKeyRows) {
      const current = grouped.get(foreignKeyRow.id) ?? {
        parentTable: foreignKeyRow.table,
        pairs: [],
      };
      current.pairs.push({ from: foreignKeyRow.from, to: foreignKeyRow.to });
      grouped.set(foreignKeyRow.id, current);
    }

    tables.set(entry.name, {
      name: entry.name,
      createSql: entry.sql,
      columns,
      foreignKeys: Array.from(grouped.values()),
    });
  }

  return { tables, indexes, triggers };
}

function resolveCompanyScopedTables(schema: SqliteSchema) {
  const included = new Set<string>();

  if (schema.tables.has("companies")) {
    included.add("companies");
  }

  for (const table of schema.tables.values()) {
    if (table.columns.some((column) => column.name === "company_id")) {
      included.add(table.name);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const table of schema.tables.values()) {
      if (included.has(table.name)) {
        continue;
      }
      if (table.foreignKeys.some((foreignKey) => included.has(foreignKey.parentTable))) {
        included.add(table.name);
        changed = true;
      }
    }
  }

  included.delete("invitation_codes");
  return included;
}

function buildTableOrder(schema: SqliteSchema, includedTables: Set<string>) {
  const inDegree = new Map<string, number>();
  const edges = new Map<string, Set<string>>();

  for (const tableName of includedTables) {
    inDegree.set(tableName, 0);
    edges.set(tableName, new Set());
  }

  for (const tableName of includedTables) {
    const table = schema.tables.get(tableName);
    if (!table) continue;

    for (const foreignKey of table.foreignKeys) {
      if (!includedTables.has(foreignKey.parentTable)) {
        continue;
      }
      if (!edges.get(foreignKey.parentTable)?.has(tableName)) {
        edges.get(foreignKey.parentTable)?.add(tableName);
        inDegree.set(tableName, (inDegree.get(tableName) ?? 0) + 1);
      }
    }
  }

  const queue = Array.from(inDegree.entries())
    .filter(([, value]) => value === 0)
    .map(([name]) => name)
    .sort();
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    for (const child of edges.get(current) ?? []) {
      const nextValue = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, nextValue);
      if (nextValue === 0) {
        queue.push(child);
        queue.sort();
      }
    }
  }

  if (ordered.length !== includedTables.size) {
    throw new HTTPException(500, { message: "Could not resolve a stable SQLite transfer order from the live schema" });
  }

  return ordered;
}

function buildCompanyPredicate(
  tableName: string,
  alias: string,
  companyId: string,
  schema: SqliteSchema,
  includedTables: Set<string>,
  cache = new Map<string, string>(),
  stack = new Set<string>(),
): string {
  const cacheKey = `${tableName}:${alias}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const table = schema.tables.get(tableName);
  if (!table) {
    throw new HTTPException(500, { message: `Table ${tableName} is missing from the live schema` });
  }

  let predicate = "";
  if (tableName === "companies") {
    predicate = `${quoteIdentifier(alias)}.${quoteIdentifier("id")} = ${quoteLiteral(companyId)}`;
  } else if (table.columns.some((column) => column.name === "company_id")) {
    predicate = `${quoteIdentifier(alias)}.${quoteIdentifier("company_id")} = ${quoteLiteral(companyId)}`;
  } else {
    if (stack.has(tableName)) {
      throw new HTTPException(500, { message: `Circular foreign-key path detected while resolving ${tableName}` });
    }

    stack.add(tableName);
    const parentPredicates = table.foreignKeys
      .filter((foreignKey) => includedTables.has(foreignKey.parentTable))
      .map((foreignKey, index) => {
        const parentAlias = `${alias}_${foreignKey.parentTable}_${index}`;
        const joinClause = foreignKey.pairs
          .map(
            (pair) =>
              `${quoteIdentifier(parentAlias)}.${quoteIdentifier(pair.to)} = ${quoteIdentifier(alias)}.${quoteIdentifier(pair.from)}`
          )
          .join(" AND ");
        const parentPredicate = buildCompanyPredicate(foreignKey.parentTable, parentAlias, companyId, schema, includedTables, cache, stack);
        return `EXISTS (SELECT 1 FROM ${quoteIdentifier(foreignKey.parentTable)} AS ${quoteIdentifier(parentAlias)} WHERE ${joinClause} AND ${parentPredicate})`;
      });
    stack.delete(tableName);

    if (parentPredicates.length === 0) {
      throw new HTTPException(500, { message: `Table ${tableName} is not directly company-scoped and has no parent path to a company-scoped table` });
    }

    predicate = parentPredicates.length === 1 ? parentPredicates[0] : `(${parentPredicates.join(" OR ")})`;
  }

  cache.set(cacheKey, predicate);
  return predicate;
}

function getSingleIntegerPrimaryKey(table: TableSchema) {
  const primaryKeyColumns = table.columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
  if (primaryKeyColumns.length !== 1) {
    return null;
  }

  const primaryKey = primaryKeyColumns[0];
  if (!/int/i.test(primaryKey.type || "")) {
    return null;
  }

  return primaryKey.name;
}

function getSharedColumnNames(sourceTable: TableSchema, targetTable: TableSchema) {
  const targetColumnNames = new Set(targetTable.columns.map((column) => column.name));
  return sourceTable.columns.map((column) => column.name).filter((columnName) => targetColumnNames.has(columnName));
}

function ensureSingleCompanyBackup(source: Database.Database) {
  const row = source.prepare("SELECT COUNT(*) AS count FROM companies").get() as { count: number };
  if ((row?.count ?? 0) !== 1) {
    throw new HTTPException(400, { message: "SQLite backup must contain exactly one company" });
  }

  const company = source.prepare("SELECT * FROM companies LIMIT 1").get() as Record<string, unknown> | undefined;

  if (!company) {
    throw new HTTPException(400, { message: "SQLite backup does not contain a company" });
  }

  return company;
}

function deleteCompanyScopedRows(target: Database.Database, schema: SqliteSchema, orderedTables: string[], companyId: string) {
  const includedTables = new Set(orderedTables);
  const reversed = [...orderedTables].reverse();

  for (const tableName of reversed) {
    if (tableName === "companies") {
      continue;
    }

    const predicate = buildCompanyPredicate(tableName, "src", companyId, schema, includedTables);
    target.exec(
      `DELETE FROM ${quoteIdentifier(tableName)}
       WHERE rowid IN (
         SELECT rowid
         FROM ${quoteIdentifier(tableName)} AS ${quoteIdentifier("src")}
         WHERE ${predicate}
       )`
    );
  }
}

function buildImportSelectExpressions(
  sourceTable: TableSchema,
  targetTable: TableSchema,
  schema: SqliteSchema,
  primaryKeyOffsets: Map<string, number>,
  desiredCompanyId: string,
) {
  const primaryKeyName = getSingleIntegerPrimaryKey(sourceTable);
  const sharedColumns = getSharedColumnNames(sourceTable, targetTable);

  return sharedColumns.map((columnName) => {
    const column = sourceTable.columns.find((entry) => entry.name === columnName)!;
    if (column.name === "company_id") {
      return `${quoteLiteral(desiredCompanyId)} AS ${quoteIdentifier(column.name)}`;
    }

    if (primaryKeyName && column.name === primaryKeyName) {
      const offset = primaryKeyOffsets.get(sourceTable.name) ?? 0;
      return `${quoteIdentifier("src")}.${quoteIdentifier(column.name)} + ${offset} AS ${quoteIdentifier(column.name)}`;
    }

    for (const foreignKey of sourceTable.foreignKeys) {
      const parentTable = schema.tables.get(foreignKey.parentTable);
      const parentPrimaryKey = parentTable ? getSingleIntegerPrimaryKey(parentTable) : null;
      const parentOffset = primaryKeyOffsets.get(foreignKey.parentTable);

      if (parentOffset === undefined || parentOffset === 0) {
        continue;
      }

      const targetPair = foreignKey.pairs.find((pair) => pair.from === column.name);
      if (!targetPair || targetPair.to !== "id") {
        continue;
      }

      if (!parentPrimaryKey) {
        continue;
      }

      return `${quoteIdentifier("src")}.${quoteIdentifier(column.name)} + ${parentOffset} AS ${quoteIdentifier(column.name)}`;
    }

    return `${quoteIdentifier("src")}.${quoteIdentifier(column.name)}`;
  });
}

function computePrimaryKeyOffsets(target: Database.Database, schema: SqliteSchema, orderedTables: string[]) {
  const offsets = new Map<string, number>();

  for (const tableName of orderedTables) {
    const table = schema.tables.get(tableName);
    if (!table || tableName === "companies") {
      continue;
    }

    const primaryKey = getSingleIntegerPrimaryKey(table);
    if (!primaryKey) {
      continue;
    }

    const row = target
      .prepare(`SELECT COALESCE(MAX(${quoteIdentifier(primaryKey)}), 0) AS value FROM ${quoteIdentifier(tableName)}`)
      .get() as { value: number };
    offsets.set(tableName, Number(row?.value ?? 0));
  }

  return offsets;
}

export function exportCompanyToSqlite(config: RuntimeConfig, companyId: string) {
  ensureNodeRuntime(config);

  const source = new Database(config.nodeSqlitePath, { readonly: true });
  const tempPath = createTempSqlitePath("jtzt-company-export");
  const target = new Database(tempPath);

  try {
    const sourceSchema = readSchema(source);
    const includedTables = resolveCompanyScopedTables(sourceSchema);
    const orderedTables = buildTableOrder(sourceSchema, includedTables);
    const company = source.prepare("SELECT name FROM companies WHERE id = ?").get(companyId) as { name: string } | undefined;

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    target.pragma("journal_mode = WAL");
    target.pragma("foreign_keys = ON");

    for (const tableName of orderedTables) {
      const table = sourceSchema.tables.get(tableName);
      if (table) {
        target.exec(table.createSql);
      }
    }

    target.exec(`ATTACH DATABASE ${quoteLiteral(config.nodeSqlitePath)} AS source`);
    const predicateCache = new Map<string, string>();

    const tx = target.transaction(() => {
      for (const tableName of orderedTables) {
        const table = sourceSchema.tables.get(tableName);
        if (!table) {
          continue;
        }

        const columnList = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
        const predicate = buildCompanyPredicate(tableName, "src", companyId, sourceSchema, includedTables, predicateCache);

        target.exec(
          `INSERT INTO ${quoteIdentifier(tableName)} (${columnList})
           SELECT ${columnList}
           FROM source.${quoteIdentifier(tableName)} AS ${quoteIdentifier("src")}
           WHERE ${predicate}`
        );
      }
    });

    tx();
    target.exec("DETACH DATABASE source");

    for (const index of sourceSchema.indexes) {
      if (index.sql && includedTables.has(index.tbl_name)) {
        target.exec(index.sql);
      }
    }
    for (const trigger of sourceSchema.triggers) {
      if (trigger.sql && includedTables.has(trigger.tbl_name)) {
        target.exec(trigger.sql);
      }
    }

    target.exec("VACUUM");

    return {
      filePath: tempPath,
      fileName: `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}.company.sqlite`,
    };
  } catch (error) {
    try {
      target.close();
    } catch {}
    try {
      source.close();
    } catch {}
    safeRemoveFile(tempPath);
    throw error;
  } finally {
    try {
      target.close();
    } catch {}
    try {
      source.close();
    } catch {}
  }
}

export function importCompanyFromSqlite(config: RuntimeConfig, sourceFilePath: string, options: { companyId?: string; companyName?: string }) {
  ensureNodeRuntime(config);

  const target = new Database(config.nodeSqlitePath);
  const source = new Database(sourceFilePath, { readonly: true });

  try {
    const targetSchema = readSchema(target);
    const sourceSchema = readSchema(source);
    const includedTables = resolveCompanyScopedTables(sourceSchema);
    const orderedTables = buildTableOrder(sourceSchema, includedTables);
    const targetIncludedTables = resolveCompanyScopedTables(targetSchema);
    const targetOrderedTables = buildTableOrder(targetSchema, targetIncludedTables);
    const sourceCompany = ensureSingleCompanyBackup(source);
    const desiredCompanyId = options.companyId?.trim() || crypto.randomUUID();
    const desiredCompanyName = options.companyName?.trim() || String(sourceCompany.name ?? "");

    const existingByName = target.prepare("SELECT id FROM companies WHERE lower(name) = lower(?)").get(desiredCompanyName) as { id: string } | undefined;
    if (existingByName && existingByName.id !== desiredCompanyId) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    target.pragma("journal_mode = WAL");
    target.pragma("foreign_keys = ON");
    target.exec(`ATTACH DATABASE ${quoteLiteral(sourceFilePath)} AS source`);

    const tx = target.transaction(() => {
      const existingCompany = target.prepare("SELECT id FROM companies WHERE id = ?").get(desiredCompanyId) as { id: string } | undefined;
      const sourceCompanyTable = sourceSchema.tables.get("companies");
      const targetCompanyTable = targetSchema.tables.get("companies");
      if (!sourceCompanyTable || !targetCompanyTable) {
        throw new HTTPException(500, { message: "Companies table is missing from source or target schema" });
      }

      const sharedCompanyColumns = getSharedColumnNames(sourceCompanyTable, targetCompanyTable);
      const companyPayload = Object.fromEntries(
        sharedCompanyColumns.map((columnName) => [columnName, sourceCompany[columnName]])
      ) as Record<string, unknown>;
      companyPayload.id = desiredCompanyId;
      companyPayload.name = desiredCompanyName;

      if (existingCompany) {
        deleteCompanyScopedRows(target, targetSchema, targetOrderedTables, desiredCompanyId);
        const updateColumns = sharedCompanyColumns.filter((columnName) => columnName !== "id");
        const assignments = updateColumns.map((columnName) => `${quoteIdentifier(columnName)} = ?`).join(", ");
        const params = updateColumns.map((columnName) => companyPayload[columnName] as SqliteBindValue);
        target
          .prepare(`UPDATE companies SET ${assignments} WHERE id = ?`)
          .run(...params, desiredCompanyId);
      } else {
        const insertColumns = sharedCompanyColumns;
        const values = insertColumns.map((columnName) => companyPayload[columnName] as SqliteBindValue);
        target
          .prepare(
            `INSERT INTO companies (${insertColumns.map((columnName) => quoteIdentifier(columnName)).join(", ")})
             VALUES (${insertColumns.map(() => "?").join(", ")})`
          )
          .run(...values);
      }

      const primaryKeyOffsets = computePrimaryKeyOffsets(target, targetSchema, targetOrderedTables);

      for (const tableName of orderedTables) {
        if (tableName === "companies") {
          continue;
        }

        const table = sourceSchema.tables.get(tableName);
        const targetTable = targetSchema.tables.get(tableName);
        if (!table || !targetTable) {
          continue;
        }

        const sharedColumns = getSharedColumnNames(table, targetTable);
        const columnList = sharedColumns.map((columnName) => quoteIdentifier(columnName)).join(", ");
        const selectExpressions = buildImportSelectExpressions(table, targetTable, sourceSchema, primaryKeyOffsets, desiredCompanyId).join(", ");
        target.exec(
          `INSERT INTO ${quoteIdentifier(tableName)} (${columnList})
           SELECT ${selectExpressions}
           FROM source.${quoteIdentifier(tableName)} AS ${quoteIdentifier("src")}`
        );
      }
    });

    tx();
    target.exec("DETACH DATABASE source");
    return { companyId: desiredCompanyId, companyName: desiredCompanyName };
  } finally {
    try {
      target.close();
    } catch {}
    try {
      source.close();
    } catch {}
  }
}
