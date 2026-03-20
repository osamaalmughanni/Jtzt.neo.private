import { DurableObject } from "cloudflare:workers";

type FetcherLike = {
  fetch(request: Request): Promise<Response>;
};

type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
};

type WorkerEnv = {
  SYSTEM_DO: DurableObjectNamespaceLike;
  COMPANY_DO: DurableObjectNamespaceLike;
  APP_ENV?: string;
  APP_VERSION?: string;
  JWT_SECRET?: string;
  SESSION_TTL_HOURS?: string;
  ADMIN_ACCESS_TOKEN?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  ASSETS: FetcherLike;
};

type SqlBridgeRequest =
  | { op: "all"; sql: string; params?: Array<string | number | null> }
  | { op: "first"; sql: string; params?: Array<string | number | null> }
  | { op: "run"; sql: string; params?: Array<string | number | null> }
  | { op: "exec"; sql: string }
  | { op: "batch"; statements: Array<{ sql: string; params?: Array<string | number | null> }> };

const systemSchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  encryption_enabled INTEGER NOT NULL DEFAULT 0,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_lower
ON companies (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_api_key_hash
ON companies (api_key_hash)
WHERE api_key_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_hash
ON companies (tablet_code_hash)
WHERE tablet_code_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tablet_code_value
ON companies (tablet_code_value)
WHERE tablet_code_value IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by_company_id TEXT,
  FOREIGN KEY (used_by_company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_status
ON invitation_codes (used_at, created_at DESC);
`;

const companySchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS company_settings (
  company_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'en-GB',
  time_zone TEXT NOT NULL DEFAULT 'Europe/Vienna',
  date_time_format TEXT NOT NULL DEFAULT 'g',
  first_day_of_week INTEGER NOT NULL DEFAULT 1,
  edit_days_limit INTEGER NOT NULL DEFAULT 30,
  insert_days_limit INTEGER NOT NULL DEFAULT 30,
  allow_one_record_per_day INTEGER NOT NULL DEFAULT 0,
  allow_intersecting_records INTEGER NOT NULL DEFAULT 0,
  allow_records_on_holidays INTEGER NOT NULL DEFAULT 1,
  allow_future_records INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'AT',
  tablet_idle_timeout_seconds INTEGER NOT NULL DEFAULT 10,
  auto_break_after_minutes INTEGER NOT NULL DEFAULT 300,
  auto_break_duration_minutes INTEGER NOT NULL DEFAULT 30,
  overtime_settings_json TEXT NOT NULL DEFAULT '{}',
  custom_fields_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  pin_code TEXT NOT NULL DEFAULT '0000',
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_name
ON users (full_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_username
ON users (company_id, username);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_pin_code
ON users (company_id, pin_code);

CREATE TABLE IF NOT EXISTS user_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  hours_per_week REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  payment_per_hour REAL NOT NULL,
  annual_vacation_days REAL NOT NULL DEFAULT 25,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_contracts_user
ON user_contracts (user_id, start_date);

CREATE TABLE IF NOT EXISTS user_contract_schedule_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  is_working_day INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (contract_id) REFERENCES user_contracts(id) ON DELETE CASCADE,
  UNIQUE(contract_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_user_contract_schedule_days_contract
ON user_contract_schedule_days (contract_id, weekday);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave', 'time_off_in_lieu')),
  entry_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  notes TEXT,
  custom_field_values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_day
ON time_entries (user_id, entry_date, end_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_type_day
ON time_entries (user_id, entry_type, entry_date, end_date);

CREATE TABLE IF NOT EXISTS public_holiday_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_cache_company_country_year
ON public_holiday_cache (company_id, country_code, year);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_active
ON projects (is_active, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_project
ON tasks (project_id, is_active, created_at);
`;

const companyResetSql = `
  DELETE FROM tasks;
  DELETE FROM time_entries;
  DELETE FROM user_contract_schedule_days;
  DELETE FROM user_contracts;
  DELETE FROM public_holiday_cache;
  DELETE FROM company_settings;
  DELETE FROM users;
  DELETE FROM projects;
`;

function hardenCompanySchema(database: { exec(sql: string): unknown }) {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_username
    ON users (company_id, username);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_pin_code
    ON users (company_id, pin_code);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_cache_company_country_year
    ON public_holiday_cache (company_id, country_code, year);
  `);
}

function resultRow(sql: SqlStorage) {
  return sql.exec("SELECT changes() AS changes, last_insert_rowid() AS lastRowId").one() as {
    changes: number;
    lastRowId: number | null;
  };
}

class SqlBackedDurableObject extends DurableObject<WorkerEnv> {
  protected readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: WorkerEnv, schema: string, kind: "system" | "company") {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(schema);
    if (kind === "company") {
      hardenCompanySchema(this.sql);
    }
  }

  protected executeRequest(body: SqlBridgeRequest) {
    switch (body.op) {
      case "all":
        return { ok: true, rows: this.sql.exec(body.sql, ...(body.params ?? [])).toArray() };
      case "first": {
        const rows = this.sql.exec(body.sql, ...(body.params ?? [])).toArray();
        return { ok: true, row: rows[0] ?? null };
      }
      case "run": {
        this.sql.exec(body.sql, ...(body.params ?? []));
        return { ok: true, result: resultRow(this.sql) };
      }
      case "exec":
        this.sql.exec(body.sql);
        return { ok: true };
      case "batch": {
        const results = this.ctx.storage.transactionSync(() => {
          const batchResults: Array<{ changes: number; lastRowId: number | null }> = [];
          for (const statement of body.statements) {
            this.sql.exec(statement.sql, ...(statement.params ?? []));
            batchResults.push(resultRow(this.sql));
          }
          return batchResults;
        });
        return { ok: true, results };
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/sql" || request.method !== "POST") {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    try {
      const body = (await request.json()) as SqlBridgeRequest;
      return Response.json(this.executeRequest(body));
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          status: 500,
        },
        { status: 500 },
      );
    }
  }
}

export class SystemDurableObject extends SqlBackedDurableObject {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env, systemSchema, "system");
  }
}

export class CompanyDurableObject extends SqlBackedDurableObject {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env, companySchema, "company");
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/admin/reset" && request.method === "POST") {
      try {
        this.ctx.storage.deleteAll();
      } catch {
        this.sql.exec(companyResetSql);
      }
      this.sql.exec(companySchema);
      hardenCompanySchema(this.sql);
      return Response.json({ ok: true });
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        runtime: "cloudflare",
        env: env.APP_ENV ?? "unknown",
        version: env.APP_VERSION ?? "unknown",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const { app } = await import("../../backend/api/app");
        return await app.fetch(request, env as any);
      } catch (error) {
        return Response.json(
          {
            error: "Worker bootstrap failure",
            path: url.pathname,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          },
          { status: 500 },
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
