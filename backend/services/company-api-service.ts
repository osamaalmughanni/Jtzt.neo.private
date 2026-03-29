import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  CompanyApiDocsResponse,
  CompanyApiMutationAction,
  CompanyApiMutationInput,
  CompanyApiMutationResponse,
  CompanyApiQueryInput,
  CompanyApiQueryResponse,
  CompanyApiSchemaColumn,
  CompanyApiSchemaResponse,
  CompanyApiTableSchema,
} from "../../shared/types/api";
import type { AppDatabase, SqlValue } from "../runtime/types";

const API_KEY_PREFIX = "jtzt_";
const EXCLUDED_TABLES = new Set(["admins", "companies", "invitation_codes", "sqlite_sequence"]);
const allowedIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const queryOperators = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in"] as const;
const mutationActions = ["insert", "update", "delete"] as const;

function hashApiKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildApiKey() {
  return `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

function quoteIdentifier(value: string) {
  if (!allowedIdentifierPattern.test(value)) {
    throw new HTTPException(400, { message: `Invalid identifier: ${value}` });
  }

  return `"${value}"`;
}

function normalizeSqlValue(value: string | number | boolean | null): SqlValue {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
}

function toSqlValues(values: Array<string | number | boolean | null>): SqlValue[] {
  return values.map(normalizeSqlValue);
}

async function readCompanyScopedTables(db: AppDatabase): Promise<CompanyApiTableSchema[]> {
  const tables = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
  );

  const result: CompanyApiTableSchema[] = [];
  for (const table of tables) {
    if (EXCLUDED_TABLES.has(table.name)) {
      continue;
    }

    if (!allowedIdentifierPattern.test(table.name)) {
      continue;
    }

    const columns = await db.all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(${quoteIdentifier(table.name)})`);

    const normalizedColumns: CompanyApiSchemaColumn[] = columns.map((column) => ({
      name: column.name,
      type: column.type || "TEXT",
      nullable: column.notnull === 0,
      primaryKey: column.pk > 0,
      example: null,
    }));
    const preferredOrderColumn =
      normalizedColumns.find((column) => column.name === "created_at")?.name ??
      normalizedColumns.find((column) => column.primaryKey)?.name ??
      normalizedColumns[0]?.name;

    result.push({
      name: table.name,
      columns: normalizedColumns,
      defaultOrderBy: preferredOrderColumn
        ? [
            {
              column: preferredOrderColumn,
              direction: preferredOrderColumn === "created_at" ? "desc" : "asc",
            },
          ]
        : [],
    });
  }

  return result;
}

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const queryFilterSchema = z.object({
  column: z.string().min(1).max(100),
  operator: z.enum(queryOperators),
  value: z.union([scalarValueSchema, z.array(scalarValueSchema)]),
});

const queryOrderBySchema = z.object({
  column: z.string().min(1).max(100),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const mutationValueSchema = z
  .record(z.string().min(1).max(100), scalarValueSchema)
  .refine((value) => Object.keys(value).length <= 200, "Too many values");

export const externalQuerySchema = z.object({
  table: z.string().min(1).max(100),
  columns: z.array(z.string().min(1).max(100)).max(200).optional(),
  filters: z.array(queryFilterSchema).max(50).optional(),
  orderBy: z.array(queryOrderBySchema).max(10).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  offset: z.number().int().min(0).max(100000).optional(),
});

export const externalMutationSchema = z.object({
  action: z.enum(mutationActions),
  table: z.string().min(1).max(100),
  values: mutationValueSchema.optional(),
  filters: z.array(queryFilterSchema).max(50).optional(),
}).superRefine((input, ctx) => {
  if (input.action === "insert" && (!input.values || Object.keys(input.values).length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["values"],
      message: "Insert requires at least one value",
    });
  }

  if ((input.action === "update" || input.action === "delete") && (!input.filters || input.filters.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["filters"],
      message: `${input.action} requires at least one filter`,
    });
  }

  if (input.action === "update" && (!input.values || Object.keys(input.values).length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["values"],
      message: "Update requires at least one value",
    });
  }
});

function buildSelectColumns(requested: string[] | undefined, table: CompanyApiTableSchema) {
  const allowedColumns = new Set(table.columns.map((column) => column.name));
  const columns = requested && requested.length > 0 ? requested : table.columns.map((column) => column.name);

  for (const column of columns) {
    if (!allowedColumns.has(column)) {
      throw new HTTPException(400, { message: `Unknown selected column: ${column}` });
    }
  }

  return columns.map(quoteIdentifier);
}

function buildWhereClause(
  filters: CompanyApiQueryInput["filters"],
  table: CompanyApiTableSchema,
) {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const allowedColumns = new Set(table.columns.map((column) => column.name));

  for (const filter of filters ?? []) {
    if (!allowedColumns.has(filter.column)) {
      throw new HTTPException(400, { message: `Unknown filter column: ${filter.column}` });
    }

    const quotedColumn = quoteIdentifier(filter.column);
    switch (filter.operator) {
      case "eq":
        clauses.push(`${quotedColumn} = ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "ne":
        clauses.push(`${quotedColumn} != ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "gt":
        clauses.push(`${quotedColumn} > ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "gte":
        clauses.push(`${quotedColumn} >= ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "lt":
        clauses.push(`${quotedColumn} < ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "lte":
        clauses.push(`${quotedColumn} <= ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "like":
        clauses.push(`${quotedColumn} LIKE ?`);
        params.push(normalizeSqlValue(filter.value as string | number | boolean | null));
        break;
      case "in": {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        if (values.length === 0) {
          throw new HTTPException(400, { message: `Filter ${filter.column} requires at least one value` });
        }
        clauses.push(`${quotedColumn} IN (${values.map(() => "?").join(", ")})`);
        params.push(...toSqlValues(values));
        break;
      }
    }
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

function ensureTableAvailable(tables: CompanyApiTableSchema[], tableName: string) {
  const table = tables.find((entry) => entry.name === tableName);
  if (!table) {
    throw new HTTPException(404, { message: "Table not available for company API" });
  }

  return table;
}

function buildOrderBy(orderBy: CompanyApiQueryInput["orderBy"], table: CompanyApiTableSchema) {
  const requested = orderBy && orderBy.length > 0 ? orderBy : table.defaultOrderBy;
  if (!requested || requested.length === 0) {
    return "";
  }

  const allowedColumns = new Set(table.columns.map((column) => column.name));
  for (const item of requested) {
    if (!allowedColumns.has(item.column)) {
      throw new HTTPException(400, { message: `Unknown order column: ${item.column}` });
    }
  }

  return `ORDER BY ${requested.map((item) => `${quoteIdentifier(item.column)} ${item.direction.toUpperCase()}`).join(", ")}`;
}

function validateWritableColumns(values: Record<string, string | number | boolean | null>, table: CompanyApiTableSchema) {
  const writableColumns = new Set(
    table.columns
      .map((column) => column.name)
      .filter((column) => column !== "id"),
  );

  const entries = Object.entries(values);
  if (entries.length === 0) {
    throw new HTTPException(400, { message: "No values provided" });
  }

  for (const [column] of entries) {
    if (!writableColumns.has(column)) {
      throw new HTTPException(400, { message: `Column is not writable: ${column}` });
    }
  }

  return entries;
}

function buildMarkdownDocs(docs: Omit<CompanyApiDocsResponse["docs"], "markdown">) {
  const endpointLines = docs.endpoints
    .map((endpoint) => `- \`${endpoint.method} ${endpoint.path}\` - ${endpoint.description}`)
    .join("\n");
  const tableLines = docs.tables
    .map((table) => {
      const columns = table.columns
        .map(
          (column) =>
            `  - \`${column.name}\` (${column.type}${column.nullable ? ", nullable" : ""}${column.primaryKey ? ", primary key" : ""})`,
        )
        .join("\n");
      return `- \`${table.name}\`\n${columns}`;
    })
    .join("\n");

  const sections = [
    "# Company API",
    "",
    "## Authentication",
    `- Header: \`${docs.auth.header}\``,
    `- Format: \`${docs.auth.format}\``,
    `- Base path: \`${docs.auth.basePath}\``,
    `- Storage: ${docs.auth.storage}`,
    "",
    "## Endpoints",
    endpointLines,
    "",
    "## Query",
    ...docs.query.notes.map((note) => `- ${note}`),
    "",
    docs.query.example ? "### Query example" : "",
    docs.query.example ? "```json" : "",
    docs.query.example ? JSON.stringify(docs.query.example, null, 2) : "",
    docs.query.example ? "```" : "",
    docs.query.curlExample ? "" : "",
    docs.query.curlExample ? "### Query cURL" : "",
    docs.query.curlExample ? "```bash" : "",
    docs.query.curlExample ?? "",
    docs.query.curlExample ? "```" : "",
    docs.query.powerQueryExample ? "" : "",
    docs.query.powerQueryExample ? "### Excel / Power Query" : "",
    docs.query.powerQueryExample ? "```text" : "",
    docs.query.powerQueryExample ?? "",
    docs.query.powerQueryExample ? "```" : "",
    "",
    "## Mutation",
    ...docs.mutation.notes.map((note) => `- ${note}`),
    "",
    docs.mutation.examples.insert ? "### Insert example" : "",
    docs.mutation.examples.insert ? "```json" : "",
    docs.mutation.examples.insert ? JSON.stringify(docs.mutation.examples.insert, null, 2) : "",
    docs.mutation.examples.insert ? "```" : "",
    docs.mutation.examples.update ? "" : "",
    docs.mutation.examples.update ? "### Update example" : "",
    docs.mutation.examples.update ? "```json" : "",
    docs.mutation.examples.update ? JSON.stringify(docs.mutation.examples.update, null, 2) : "",
    docs.mutation.examples.update ? "```" : "",
    docs.mutation.examples.delete ? "" : "",
    docs.mutation.examples.delete ? "### Delete example" : "",
    docs.mutation.examples.delete ? "```json" : "",
    docs.mutation.examples.delete ? JSON.stringify(docs.mutation.examples.delete, null, 2) : "",
    docs.mutation.examples.delete ? "```" : "",
    "",
    "## Tables",
    tableLines,
  ];

  return sections.filter(Boolean).join("\n");
}

export const companyApiService = {
  async getApiKeyStatus(db: AppDatabase, companyId: string) {
    const row = await db.first<{ api_key_hash: string | null; api_key_created_at: string | null }>(
      "SELECT api_key_hash, api_key_created_at FROM companies WHERE id = ?",
      [companyId],
    );
    if (!row) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    return {
      configured: Boolean(row.api_key_hash),
      createdAt: row.api_key_created_at,
    };
  },

  async rotateApiKey(db: AppDatabase, companyId: string) {
    const apiKey = buildApiKey();
    const createdAt = new Date().toISOString();
    const result = await db.run(
      "UPDATE companies SET api_key_hash = ?, api_key_created_at = ? WHERE id = ?",
      [hashApiKey(apiKey), createdAt, companyId],
    );
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    return {
      apiKey,
      status: {
        configured: true,
        createdAt,
      },
    };
  },

  async getCompanyByApiKey(db: AppDatabase, apiKey: string) {
    const hash = hashApiKey(apiKey.trim());
    return db.first<{ id: string; name: string }>(
      "SELECT id, name FROM companies WHERE api_key_hash = ?",
      [hash],
    );
  },

  async getSchema(db: AppDatabase): Promise<CompanyApiSchemaResponse> {
    try {
      const tables = await readCompanyScopedTables(db);
      return {
        tables,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown schema introspection error";
      throw new HTTPException(500, { message: `Company API schema introspection failed: ${message}` });
    }
  },

  async queryTable(db: AppDatabase, companyId: string, input: CompanyApiQueryInput): Promise<CompanyApiQueryResponse> {
    const tables = await readCompanyScopedTables(db);
    const table = ensureTableAvailable(tables, input.table);

    const selectColumns = buildSelectColumns(input.columns, table);
    const selectedColumnNames = selectColumns.map((column) => column.slice(1, -1));
    const where = buildWhereClause(input.filters, table);
    const orderBy = buildOrderBy(input.orderBy, table);
    const limit = input.limit ?? 250;
    const offset = input.offset ?? 0;
    const tableName = quoteIdentifier(table.name);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT ${selectColumns.join(", ")} FROM ${tableName} ${where.sql} ${orderBy} LIMIT ? OFFSET ?`,
      [...where.params, limit, offset],
    );
    const totalRow = await db.first<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM ${tableName} ${where.sql}`,
      where.params,
    );

    return {
      table: table.name,
      columns: selectedColumnNames,
      rows,
      total: Number(totalRow?.count ?? 0),
      limit,
      offset,
    };
  },

  async mutateTable(db: AppDatabase, companyId: string, input: CompanyApiMutationInput): Promise<CompanyApiMutationResponse> {
    const tables = await readCompanyScopedTables(db);
    const table = ensureTableAvailable(tables, input.table);
    const tableName = quoteIdentifier(table.name);

    if (input.action === "insert") {
      const values = validateWritableColumns(input.values ?? {}, table);
      const columns = values.map(([column]) => quoteIdentifier(column));
      const params: SqlValue[] = values.map(([, value]) => normalizeSqlValue(value));
      const placeholders = columns.map(() => "?").join(", ");
      const result = await db.run(
        `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
        params,
      );

      return {
        action: input.action,
        table: table.name,
        affectedRows: result.changes,
        insertedRowId: result.lastRowId,
      };
    }

    const where = buildWhereClause(input.filters, table);
    const hasAdditionalFilter = (input.filters?.length ?? 0) > 0;
    if (!hasAdditionalFilter) {
      throw new HTTPException(400, { message: `${input.action} requires at least one filter` });
    }

    if (input.action === "update") {
      const values = validateWritableColumns(input.values ?? {}, table);
      const assignments = values.map(([column]) => `${quoteIdentifier(column)} = ?`);
      const params = [...values.map(([, value]) => normalizeSqlValue(value)), ...where.params];
      const result = await db.run(
        `UPDATE ${tableName} SET ${assignments.join(", ")} ${where.sql}`,
        params,
      );

      return {
        action: input.action,
        table: table.name,
        affectedRows: result.changes,
        insertedRowId: null,
      };
    }

    const result = await db.run(`DELETE FROM ${tableName} ${where.sql}`, where.params);
    return {
      action: input.action,
      table: table.name,
      affectedRows: result.changes,
      insertedRowId: null,
    };
  },

  async getGeneratedDocs(db: AppDatabase): Promise<CompanyApiDocsResponse["docs"]> {
    try {
      const tables = await readCompanyScopedTables(db);
      const docsWithoutMarkdown: Omit<CompanyApiDocsResponse["docs"], "markdown"> = {
        auth: {
          header: "X-API-Key",
          format: `${API_KEY_PREFIX}...`,
          basePath: "/api/external",
          storage: "Only the SHA-256 hash of the key is stored. Rotating the key immediately invalidates the previous value.",
        },
        endpoints: [
          {
            method: "GET",
            path: "/api/external",
            title: "Service index",
            description: "Returns the authenticated service overview and, when a valid key is supplied, the current generated API documentation.",
          },
          {
            method: "GET",
            path: "/api/external/docs",
            title: "Generated docs",
            description: "Returns the current authenticated documentation payload built from the live schema.",
          },
          {
            method: "GET",
            path: "/api/external/schema",
            title: "Live schema",
            description: "Discovers every company-scoped table and column directly from the current database.",
          },
          {
            method: "POST",
            path: "/api/external/query",
            title: "Generic company query",
            description: "Runs validated read queries against any discovered company table without schema-specific endpoints.",
          },
          {
            method: "POST",
            path: "/api/external/mutate",
            title: "Generic company mutation",
            description: "Runs validated insert, update, and delete operations against discovered company tables with automatic company scoping.",
          },
        ],
        query: {
          operators: [...queryOperators],
          notes: [
            "Every query is automatically scoped to the authenticated company.",
            "Table names and columns are validated against the live schema before SQL is built.",
            "The schema endpoint reflects the current database state directly.",
          ],
          example: null,
          curlExample: null,
          powerQueryExample: null,
        },
        mutation: {
          actions: [...mutationActions],
          notes: [
            "Mutations are validated against the live schema before SQL is built.",
            "Update and delete operations require filters to reduce accidental broad writes.",
          ],
          examples: {
            insert: null,
            update: null,
            delete: null,
          },
          curlExamples: {
            insert: null,
            update: null,
            delete: null,
          },
        },
        tables,
      };

      return {
        ...docsWithoutMarkdown,
        markdown: buildMarkdownDocs(docsWithoutMarkdown),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown documentation generation error";
      throw new HTTPException(500, { message: `Company API docs generation failed: ${message}` });
    }
  },
};
