import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { companySchema } from "../db/schema";
import type { AppDatabase, SqlStatement, SqlValue } from "../runtime/types";
import { systemService } from "./system-service";

const NULL_TOKEN = "\\N";
const COMPANY_METADATA_FILE_NAME = "company.csv";
const SCHEMA_FILE_NAME = "migration-schema.json";
const ZIP_CONTENT_TYPE = "application/zip";
const EXCLUDED_TABLES = new Set(["sqlite_sequence"]);

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
  fileName: string;
  columns: MigrationColumn[];
  foreignKeys: MigrationForeignKey[];
  hasCompanyId: boolean;
  primaryKeyColumns: string[];
};

type ParsedCsv = {
  headers: string[];
  records: string[][];
};

type UploadedMigrationFile = {
  name: string;
  text: string;
};

type MigrationArchiveFile = {
  fileName: string;
  contentType: string;
  rowCount: number;
  content: string;
};

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function readUInt16(buffer: Uint8Array, offset: number) {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readUInt32(buffer: Uint8Array, offset: number) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}

function writeUInt16(value: number) {
  const buffer = new Uint8Array(2);
  buffer[0] = value & 0xff;
  buffer[1] = (value >>> 8) & 0xff;
  return buffer;
}

function writeUInt32(value: number) {
  const buffer = new Uint8Array(4);
  buffer[0] = value & 0xff;
  buffer[1] = (value >>> 8) & 0xff;
  buffer[2] = (value >>> 16) & 0xff;
  buffer[3] = (value >>> 24) & 0xff;
  return buffer;
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return combined;
}

function toBase64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;

    output += alphabet[(triple >>> 18) & 0x3f];
    output += alphabet[(triple >>> 12) & 0x3f];
    output += index + 1 < bytes.length ? alphabet[(triple >>> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 0x3f] : "=";
  }

  return output;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: MigrationArchiveFile[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.fileName);
    const contentBytes = encoder.encode(file.content);
    const fileCrc32 = crc32(contentBytes);
    const flags = 0x0800;
    const compressionMethod = 0;

    const localHeader = concatBytes([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(flags),
      writeUInt16(compressionMethod),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(fileCrc32),
      writeUInt32(contentBytes.length),
      writeUInt32(contentBytes.length),
      writeUInt16(nameBytes.length),
      writeUInt16(0),
      nameBytes,
    ]);

    localParts.push(localHeader, contentBytes);

    const centralHeader = concatBytes([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(flags),
      writeUInt16(compressionMethod),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(fileCrc32),
      writeUInt32(contentBytes.length),
      writeUInt32(contentBytes.length),
      writeUInt16(nameBytes.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      nameBytes,
    ]);

    centralParts.push(centralHeader);
    offset += localHeader.length + contentBytes.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const endOfCentralDirectory = concatBytes([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return concatBytes([...localParts, centralDirectory, endOfCentralDirectory]);
}

function unzipArchive(buffer: Uint8Array) {
  const decoder = new TextDecoder();
  let endOfCentralDirectoryOffset = -1;

  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (readUInt32(buffer, index) === 0x06054b50) {
      endOfCentralDirectoryOffset = index;
      break;
    }
  }

  if (endOfCentralDirectoryOffset === -1) {
    throw new HTTPException(400, { message: "ZIP archive is missing an end of central directory record" });
  }

  const entryCount = readUInt16(buffer, endOfCentralDirectoryOffset + 10);
  const centralDirectoryOffset = readUInt32(buffer, endOfCentralDirectoryOffset + 16);
  let offset = centralDirectoryOffset;
  const files = new Map<string, UploadedMigrationFile>();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new HTTPException(400, { message: "ZIP archive central directory is invalid" });
    }

    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraFieldLength = readUInt16(buffer, offset + 30);
    const fileCommentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const fileName = decoder.decode(buffer.slice(offset + 46, offset + 46 + fileNameLength));
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (!fileName || fileName.endsWith("/")) {
      continue;
    }

    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
      throw new HTTPException(400, { message: `ZIP archive entry is invalid: ${fileName}` });
    }

    const localFileNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraFieldLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    const contentBytes = buffer.slice(dataOffset, dataOffset + compressedSize);
    if (compressionMethod === 0) {
      files.set(fileName.split(/[\\/]/).pop() ?? fileName, {
        name: fileName,
        text: decoder.decode(contentBytes),
      });
      continue;
    }

    if (compressionMethod === 8) {
      throw new HTTPException(400, {
        message: `ZIP archive entry ${fileName} uses deflate compression. Upload the original JTZT migration zip or unpacked CSV files.`,
      });
    } else {
      throw new HTTPException(400, { message: `ZIP compression method is not supported for ${fileName}` });
    }
  }

  return files;
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
      fileName: `${tableName}.csv`,
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
        fileName: `${row.name}.csv`,
        columns,
        foreignKeys,
        hasCompanyId: columns.some((column) => column.name === "company_id"),
        primaryKeyColumns: columns.filter((column) => column.primaryKey).map((column) => column.name),
      } satisfies MigrationTable;
    });
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

function encodeCell(value: unknown) {
  if (value === null || value === undefined) {
    return NULL_TOKEN;
  }

  const text = String(value);
  if (text.startsWith("\\")) {
    return `\\${text}`;
  }

  return text;
}

function decodeCell(value: string) {
  if (value === NULL_TOKEN) {
    return null;
  }
  if (value.startsWith("\\\\")) {
    return value.slice(1);
  }
  return value;
}

function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function serializeCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(encodeCell(row[header]))).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        const next = text[index + 1];
        if (next === "\"") {
          currentCell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  const normalizedRows = rows.filter((row, index) => index === 0 || row.some((cell) => cell.length > 0));
  const [headers, ...records] = normalizedRows;
  if (!headers || headers.length === 0) {
    throw new HTTPException(400, { message: "CSV file is missing a header row" });
  }

  return { headers, records };
}

function buildCompanyMetadataColumns(): MigrationColumn[] {
  return [
    { name: "name", type: "TEXT", nullable: false, primaryKey: false },
    { name: "encryption_enabled", type: "INTEGER", nullable: false, primaryKey: false },
    { name: "encryption_kdf_algorithm", type: "TEXT", nullable: true, primaryKey: false },
    { name: "encryption_kdf_iterations", type: "INTEGER", nullable: true, primaryKey: false },
    { name: "encryption_kdf_salt", type: "TEXT", nullable: true, primaryKey: false },
    { name: "encryption_key_verifier", type: "TEXT", nullable: true, primaryKey: false },
    { name: "api_key_hash", type: "TEXT", nullable: true, primaryKey: false },
    { name: "api_key_created_at", type: "TEXT", nullable: true, primaryKey: false },
    { name: "tablet_code_value", type: "TEXT", nullable: true, primaryKey: false },
    { name: "tablet_code_hash", type: "TEXT", nullable: true, primaryKey: false },
    { name: "tablet_code_updated_at", type: "TEXT", nullable: true, primaryKey: false },
    { name: "created_at", type: "TEXT", nullable: false, primaryKey: false },
  ];
}

function buildMigrationSchemaDocument(tables: MigrationTable[]) {
  const orderedTables = buildIncludedTableOrder(tables);

  return {
    format: {
      key: "jtzt-company-csv-migration",
      version: 1,
      encoding: "UTF-8",
      delimiter: ",",
      lineTerminator: "LF",
      nullToken: NULL_TOKEN,
      oneCsvPerTable: true,
      schemaFileName: SCHEMA_FILE_NAME,
      metadataFileName: COMPANY_METADATA_FILE_NAME,
    },
    companyMetadata: {
      fileName: COMPANY_METADATA_FILE_NAME,
      description: "Single-row company-level metadata that does not live inside the company database file itself.",
      columns: buildCompanyMetadataColumns().map((column) => ({
        ...column,
        example: inferExampleValue(column),
      })),
    },
    tables: orderedTables.map((table) => ({
      tableName: table.name,
      fileName: table.fileName,
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
      "Use exact file names and exact header order.",
      "Dates and timestamps must stay locale-neutral and ISO-like exactly as exported.",
      "Boolean values are stored as 1 or 0.",
      "JSON payload columns must contain valid JSON text.",
      "All imports fully replace the target company dataset before inserts run.",
    ],
  };
}

function buildOrderByClause(table: MigrationTable) {
  const preferredColumns = table.primaryKeyColumns.length > 0 ? table.primaryKeyColumns : table.columns.slice(0, 1).map((column) => column.name);
  return preferredColumns.length > 0
    ? ` ORDER BY ${preferredColumns.map((column) => quoteIdentifier(column)).join(", ")}`
    : "";
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

function convertImportedValue(column: MigrationColumn, rawValue: string, targetCompanyId: string) {
  const decoded = decodeCell(rawValue);
  if (column.name === "company_id") {
    return targetCompanyId;
  }
  if (decoded === null) {
    if (!column.nullable) {
      throw new HTTPException(400, { message: `Column ${column.name} cannot be null` });
    }
    return null;
  }

  const type = column.type.toLowerCase();
  if (type.includes("int")) {
    const value = Number(decoded);
    if (!Number.isInteger(value)) {
      throw new HTTPException(400, { message: `Column ${column.name} requires an integer value` });
    }
    return value;
  }
  if (type.includes("real") || type.includes("numeric")) {
    const value = Number(decoded);
    if (Number.isNaN(value)) {
      throw new HTTPException(400, { message: `Column ${column.name} requires a numeric value` });
    }
    return value;
  }
  return decoded;
}

function normalizeStatementsChunk(statements: SqlStatement[], size = 250) {
  const chunks: SqlStatement[][] = [];
  for (let index = 0; index < statements.length; index += size) {
    chunks.push(statements.slice(index, index + size));
  }
  return chunks;
}

async function readUploadedFiles(files: File[]) {
  const uploadedFiles = new Map<string, UploadedMigrationFile>();

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const archiveFiles = unzipArchive(new Uint8Array(await file.arrayBuffer()));
      for (const [name, entry] of archiveFiles) {
        uploadedFiles.set(name, { name, text: entry.text });
      }
      continue;
    }

    uploadedFiles.set(file.name, {
      name: file.name,
      text: await file.text(),
    });
  }

  return uploadedFiles;
}

function parseCompanyMetadata(text: string) {
  const parsed = parseCsv(text);
  const expectedHeaders = buildCompanyMetadataColumns().map((column) => column.name);
  if (parsed.headers.join(",") !== expectedHeaders.join(",")) {
    throw new HTTPException(400, { message: `Invalid ${COMPANY_METADATA_FILE_NAME} header` });
  }
  if (parsed.records.length !== 1) {
    throw new HTTPException(400, { message: `${COMPANY_METADATA_FILE_NAME} must contain exactly one data row` });
  }

  const row = parsed.records[0];
  const metadata = Object.fromEntries(expectedHeaders.map((header, index) => [header, decodeCell(row[index] ?? "")])) as Record<string, string | null>;
  return {
    name: metadata.name ?? "",
    encryptionEnabled: metadata.encryption_enabled === "1",
    encryptionKdfAlgorithm: metadata.encryption_kdf_algorithm,
    encryptionKdfIterations: metadata.encryption_kdf_iterations ? Number(metadata.encryption_kdf_iterations) : null,
    encryptionKdfSalt: metadata.encryption_kdf_salt,
    encryptionKeyVerifier: metadata.encryption_key_verifier,
    apiKeyHash: metadata.api_key_hash,
    apiKeyCreatedAt: metadata.api_key_created_at,
    tabletCodeValue: metadata.tablet_code_value,
    tabletCodeHash: metadata.tablet_code_hash,
    tabletCodeUpdatedAt: metadata.tablet_code_updated_at,
    createdAt: metadata.created_at ?? new Date().toISOString(),
  };
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

  return {
    rowCount: filteredRows.length,
    content: serializeCsv(columnNames, filteredRows),
  };
}

async function clearImportedTables(db: AppDatabase, orderedTables: MigrationTable[]) {
  const statements = orderedTables
    .slice()
    .reverse()
    .map((table) => ({ sql: `DELETE FROM ${quoteIdentifier(table.name)}` }));

  for (const chunk of normalizeStatementsChunk(statements, 25)) {
    await db.batch(chunk);
  }
}

async function importTableData(
  db: AppDatabase,
  orderedTables: MigrationTable[],
  uploadedFiles: Map<string, UploadedMigrationFile>,
  targetCompanyId: string,
) {
  for (const table of orderedTables) {
    const file = uploadedFiles.get(table.fileName);
    if (!file) {
      throw new HTTPException(400, { message: `Required migration file is missing: ${table.fileName}` });
    }

    const parsed = parseCsv(file.text);
    const expectedHeaders = table.columns.map((column) => column.name);
    if (parsed.headers.join(",") !== expectedHeaders.join(",")) {
      throw new HTTPException(400, { message: `Invalid header for ${table.fileName}` });
    }

    const statements: SqlStatement[] = parsed.records.map((record) => {
      if (record.length !== expectedHeaders.length) {
        throw new HTTPException(400, { message: `Invalid column count in ${table.fileName}` });
      }

      const params = table.columns.map((column, index) => convertImportedValue(column, record[index] ?? "", targetCompanyId)) as SqlValue[];
      return {
        sql: `INSERT INTO ${quoteIdentifier(table.name)} (${expectedHeaders.map(quoteIdentifier).join(", ")}) VALUES (${expectedHeaders.map(() => "?").join(", ")})`,
        params,
      };
    });

    for (const chunk of normalizeStatementsChunk(statements)) {
      if (chunk.length > 0) {
        await db.batch(chunk);
      }
    }
  }
}

export const adminCsvMigrationService = {
  async getSchema() {
    return buildMigrationSchemaDocument(parseTablesFromSchemaSql(companySchema));
  },

  async exportCompany(systemDb: AppDatabase, companyDb: AppDatabase, companyId: string) {
    const company = await systemDb.first<{
      name: string;
      encryption_enabled: number;
      encryption_kdf_algorithm: string | null;
      encryption_kdf_iterations: number | null;
      encryption_kdf_salt: string | null;
      encryption_key_verifier: string | null;
      api_key_hash: string | null;
      api_key_created_at: string | null;
      tablet_code_value: string | null;
      tablet_code_hash: string | null;
      tablet_code_updated_at: string | null;
      created_at: string;
    }>(
      `SELECT
        name,
        encryption_enabled,
        encryption_kdf_algorithm,
        encryption_kdf_iterations,
        encryption_kdf_salt,
        encryption_key_verifier,
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
    const selectedParentKeys = new Map<string, Set<string>>();
    const files: MigrationArchiveFile[] = [
      {
        fileName: COMPANY_METADATA_FILE_NAME,
        contentType: "text/csv;charset=utf-8",
        rowCount: 1,
        content: serializeCsv(
          buildCompanyMetadataColumns().map((column) => column.name),
          [
            {
              name: company.name,
              encryption_enabled: company.encryption_enabled,
              encryption_kdf_algorithm: company.encryption_kdf_algorithm,
              encryption_kdf_iterations: company.encryption_kdf_iterations,
              encryption_kdf_salt: company.encryption_kdf_salt,
              encryption_key_verifier: company.encryption_key_verifier,
              api_key_hash: company.api_key_hash,
              api_key_created_at: company.api_key_created_at,
              tablet_code_value: company.tablet_code_value,
              tablet_code_hash: company.tablet_code_hash,
              tablet_code_updated_at: company.tablet_code_updated_at,
              created_at: company.created_at,
            },
          ],
        ),
      },
      {
        fileName: SCHEMA_FILE_NAME,
        contentType: "application/json",
        rowCount: 0,
        content: JSON.stringify(buildMigrationSchemaDocument(orderedTables), null, 2),
      },
    ];

    for (const table of orderedTables) {
      const exported = await exportTableRows(companyDb, table, companyId, selectedParentKeys);
      files.push({
        fileName: table.fileName,
        contentType: "text/csv;charset=utf-8",
        rowCount: exported.rowCount,
        content: exported.content,
      });
    }

    const packageName = `${slugify(company.name)}-migration`;

    const archive = buildZipArchive(files);

    return {
      packageName,
      fileName: `${packageName}.zip`,
      contentType: ZIP_CONTENT_TYPE,
      exportedAt: new Date().toISOString(),
      files,
      archive,
      archiveBase64: toBase64(archive),
    };
  },

  async createCompanyFromCsv(
    systemDb: AppDatabase,
    companyDb: AppDatabase,
    input: { files: File[]; name?: string },
    companyId = crypto.randomUUID(),
  ) {
    const uploadedFiles = await readUploadedFiles(input.files);
    const companyMetadataFile = uploadedFiles.get(COMPANY_METADATA_FILE_NAME);
    if (!companyMetadataFile) {
      throw new HTTPException(400, { message: `${COMPANY_METADATA_FILE_NAME} is required` });
    }

    const metadata = parseCompanyMetadata(companyMetadataFile.text);
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
        encryption_enabled,
        encryption_kdf_algorithm,
        encryption_kdf_iterations,
        encryption_kdf_salt,
        encryption_key_verifier,
        api_key_hash,
        api_key_created_at,
        tablet_code_value,
        tablet_code_hash,
        tablet_code_updated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        companyName,
        metadata.encryptionEnabled ? 1 : 0,
        metadata.encryptionKdfAlgorithm,
        metadata.encryptionKdfIterations,
        metadata.encryptionKdfSalt,
        metadata.encryptionKeyVerifier,
        metadata.apiKeyHash,
        metadata.apiKeyCreatedAt,
        metadata.tabletCodeValue,
        metadata.tabletCodeHash,
        metadata.tabletCodeUpdatedAt,
        metadata.createdAt,
      ],
    );

    try {
      const orderedTables = await loadMigrationTables(companyDb);
      await clearImportedTables(companyDb, orderedTables);
      await importTableData(companyDb, orderedTables, uploadedFiles, companyId);
    } catch (error) {
      await systemDb.run("DELETE FROM companies WHERE id = ?", [companyId]);
      throw error;
    }

    return systemService.getCompanyById(systemDb, companyId);
  },

  async replaceCompanyFromCsv(
    systemDb: AppDatabase,
    companyDb: AppDatabase,
    input: { companyId: string; companyName?: string; files: File[] },
  ) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const uploadedFiles = await readUploadedFiles(input.files);
    const companyMetadataFile = uploadedFiles.get(COMPANY_METADATA_FILE_NAME);
    if (!companyMetadataFile) {
      throw new HTTPException(400, { message: `${COMPANY_METADATA_FILE_NAME} is required` });
    }

    const metadata = parseCompanyMetadata(companyMetadataFile.text);
    const targetName = input.companyName?.trim() || metadata.name.trim() || company.name;
    const existingByName = await systemService.getCompanyByName(systemDb, targetName);
    if (existingByName && existingByName.id !== input.companyId) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    const orderedTables = await loadMigrationTables(companyDb);
    await clearImportedTables(companyDb, orderedTables);
    await importTableData(companyDb, orderedTables, uploadedFiles, input.companyId);

    await systemDb.run(
      `UPDATE companies
       SET
         name = ?,
         encryption_enabled = ?,
         encryption_kdf_algorithm = ?,
         encryption_kdf_iterations = ?,
         encryption_kdf_salt = ?,
         encryption_key_verifier = ?,
         api_key_hash = ?,
         api_key_created_at = ?,
         tablet_code_value = ?,
         tablet_code_hash = ?,
         tablet_code_updated_at = ?,
         created_at = ?
       WHERE id = ?`,
      [
        targetName,
        metadata.encryptionEnabled ? 1 : 0,
        metadata.encryptionKdfAlgorithm,
        metadata.encryptionKdfIterations,
        metadata.encryptionKdfSalt,
        metadata.encryptionKeyVerifier,
        metadata.apiKeyHash,
        metadata.apiKeyCreatedAt,
        metadata.tabletCodeValue,
        metadata.tabletCodeHash,
        metadata.tabletCodeUpdatedAt,
        metadata.createdAt,
        input.companyId,
      ],
    );

    return systemService.getCompanyById(systemDb, input.companyId);
  },
};
