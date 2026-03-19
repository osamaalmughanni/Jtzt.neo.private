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
const EXCLUDED_TABLES = new Set(["admins", "companies", "sqlite_sequence"]);
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

function inferExampleValue(column: CompanyApiSchemaColumn): string | number | null {
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();

  if (name.endsWith("_id")) {
    return column.name === "company_id" ? "company_guid" : 1;
  }
  if (name.includes("date")) {
    return "2026-01-01";
  }
  if (name.includes("time")) {
    return "09:00";
  }
  if (name.includes("email")) {
    return "name@example.com";
  }
  if (name.startsWith("is_") || name.startsWith("has_") || name.endsWith("_enabled")) {
    return 1;
  }
  if (type.includes("int") || type.includes("real") || type.includes("numeric")) {
    return 1;
  }
  if (type.includes("json")) {
    return "{}";
  }
  if (column.nullable) {
    return null;
  }

  return `${column.name}_value`;
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
      name: string;
      type: string;
      is_not_null: number;
      pk: number;
    }>(
      `SELECT name, type, "notnull" AS is_not_null, pk FROM pragma_table_info('${table.name}') ORDER BY cid ASC`,
    );

    if (!columns.some((column) => column.name === "company_id")) {
      continue;
    }

    const normalizedColumns: CompanyApiSchemaColumn[] = columns.map((column) => ({
      name: column.name,
      type: column.type || "TEXT",
      nullable: column.is_not_null === 0,
      primaryKey: column.pk > 0,
      example: inferExampleValue({
        name: column.name,
        type: column.type || "TEXT",
        nullable: column.is_not_null === 0,
        primaryKey: column.pk > 0,
        example: null,
      }),
    }));
    const preferredOrderColumn =
      normalizedColumns.find((column) => column.name === "created_at")?.name ??
      normalizedColumns.find((column) => column.primaryKey)?.name ??
      normalizedColumns.find((column) => column.name !== "company_id")?.name ??
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
  companyId: string,
  filters: CompanyApiQueryInput["filters"],
  table: CompanyApiTableSchema,
) {
  const clauses = [`${quoteIdentifier("company_id")} = ?`];
  const params: SqlValue[] = [companyId];
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
      .filter((column) => column !== "company_id" && column !== "id"),
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

function buildExampleQuery(tables: CompanyApiTableSchema[]): CompanyApiQueryInput | null {
  const table = tables[0];
  if (!table) {
    return null;
  }

  const visibleColumns = table.columns.filter((column) => column.name !== "company_id");
  const selectedColumns = visibleColumns.slice(0, 5).map((column) => column.name);
  const firstFilterColumn =
    visibleColumns.find((column) => column.name.includes("date")) ??
    visibleColumns.find((column) => column.name.startsWith("is_")) ??
    visibleColumns[0];

  return {
    table: table.name,
    columns: selectedColumns.length > 0 ? selectedColumns : table.columns.slice(0, 5).map((column) => column.name),
    filters: firstFilterColumn
      ? [
          {
            column: firstFilterColumn.name,
            operator: "eq",
            value: firstFilterColumn.example,
          },
        ]
      : [],
    orderBy: table.defaultOrderBy,
    limit: 100,
    offset: 0,
  };
}

function buildExampleMutation(
  tables: CompanyApiTableSchema[],
  action: CompanyApiMutationAction,
): CompanyApiMutationInput | null {
  const table = tables[0];
  if (!table) {
    return null;
  }

  const writableColumns = table.columns.filter((column) => column.name !== "company_id" && column.name !== "id");
  const firstWritableColumn = writableColumns[0];
  const filterColumn =
    table.columns.find((column) => column.primaryKey && column.name !== "company_id") ??
    writableColumns.find((column) => column.name.includes("date")) ??
    writableColumns[0];

  if (action === "insert") {
    return {
      action,
      table: table.name,
      values: Object.fromEntries(
        writableColumns.slice(0, 3).map((column) => [column.name, column.example]),
      ),
    };
  }

  if (!firstWritableColumn || !filterColumn) {
    return null;
  }

  return {
    action,
    table: table.name,
    values: action === "update" ? { [firstWritableColumn.name]: firstWritableColumn.example } : undefined,
    filters: [
      {
        column: filterColumn.name,
        operator: "eq",
        value: filterColumn.example,
      },
    ],
  };
}

function buildCurlExample(path: string, body: CompanyApiQueryInput | CompanyApiMutationInput | null) {
  if (!body) {
    return null;
  }

  return [
    "curl -X POST \\",
    '  -H "Content-Type: application/json" \\',
    `  -H "X-API-Key: ${API_KEY_PREFIX}your_company_key" \\`,
    `  https://your-app.example.com${path} \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");
}

function buildPowerQueryExample(example: CompanyApiQueryInput | null) {
  if (!example) {
    return null;
  }

  return [
    "let",
    '  ApiUrl = "https://your-app.example.com/api/external/query",',
    `  RequestBody = Text.ToBinary("${JSON.stringify(example).replace(/"/g, '""')}"),`,
    '  Response = Json.Document(Web.Contents(ApiUrl, [',
    '    Headers = [#"Content-Type" = "application/json", #"X-API-Key" = "jtzt_your_company_key"],',
    "    Content = RequestBody",
    "  ])),",
    '  Rows = Response[rows],',
    "  Table = Table.FromRecords(Rows)",
    "in",
    "  Table",
  ].join("\n");
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
    docs.query.example ? "### Example query body" : "",
    docs.query.example ? "```json" : "",
    docs.query.example ? JSON.stringify(docs.query.example, null, 2) : "",
    docs.query.example ? "```" : "",
    docs.query.curlExample ? "" : "",
    docs.query.curlExample ? "### Example query cURL" : "",
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
    docs.mutation.examples.insert ? "### Example insert body" : "",
    docs.mutation.examples.insert ? "```json" : "",
    docs.mutation.examples.insert ? JSON.stringify(docs.mutation.examples.insert, null, 2) : "",
    docs.mutation.examples.insert ? "```" : "",
    docs.mutation.examples.update ? "" : "",
    docs.mutation.examples.update ? "### Example update body" : "",
    docs.mutation.examples.update ? "```json" : "",
    docs.mutation.examples.update ? JSON.stringify(docs.mutation.examples.update, null, 2) : "",
    docs.mutation.examples.update ? "```" : "",
    docs.mutation.examples.delete ? "" : "",
    docs.mutation.examples.delete ? "### Example delete body" : "",
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
    return {
      tables: await readCompanyScopedTables(db),
    };
  },

  async queryTable(db: AppDatabase, companyId: string, input: CompanyApiQueryInput): Promise<CompanyApiQueryResponse> {
    const tables = await readCompanyScopedTables(db);
    const table = ensureTableAvailable(tables, input.table);

    const selectColumns = buildSelectColumns(input.columns, table);
    const selectedColumnNames = selectColumns.map((column) => column.slice(1, -1));
    const where = buildWhereClause(companyId, input.filters, table);
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
      const columns = [`${quoteIdentifier("company_id")}`, ...values.map(([column]) => quoteIdentifier(column))];
      const params: SqlValue[] = [companyId, ...values.map(([, value]) => normalizeSqlValue(value))];
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

    const where = buildWhereClause(companyId, input.filters, table);
    const hasAdditionalFilter = (input.filters?.length ?? 0) > 0;
    if (!hasAdditionalFilter) {
      throw new HTTPException(400, { message: `${input.action} requires at least one non-company filter` });
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
    const schema = await this.getSchema(db);
    const exampleQuery = buildExampleQuery(schema.tables);
    const mutationExamples = {
      insert: buildExampleMutation(schema.tables, "insert"),
      update: buildExampleMutation(schema.tables, "update"),
      delete: buildExampleMutation(schema.tables, "delete"),
    };
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
          "The schema endpoint updates itself as your database evolves, so the API page stays in sync.",
        ],
        example: exampleQuery,
        curlExample: buildCurlExample("/api/external/query", exampleQuery),
        powerQueryExample: buildPowerQueryExample(exampleQuery),
      },
      mutation: {
        actions: [...mutationActions],
        notes: [
          "Mutations are validated against the live schema before SQL is built.",
          "company_id is injected automatically and cannot be overridden by clients.",
          "Update and delete operations require filters to reduce accidental broad writes.",
        ],
        examples: mutationExamples,
        curlExamples: {
          insert: buildCurlExample("/api/external/mutate", mutationExamples.insert),
          update: buildCurlExample("/api/external/mutate", mutationExamples.update),
          delete: buildCurlExample("/api/external/mutate", mutationExamples.delete),
        },
      },
      tables: schema.tables,
    };

    return {
      ...docsWithoutMarkdown,
      markdown: buildMarkdownDocs(docsWithoutMarkdown),
    };
  },
};
