export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

export interface RunResult {
  changes: number;
  lastRowId: number | null;
}

export interface AppDatabase {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  batch(statements: SqlStatement[]): Promise<RunResult[]>;
  exec(sql: string): Promise<void>;
}

export interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface RuntimeBindings {
  SYSTEM_DO?: DurableObjectNamespaceLike;
  COMPANY_DO?: DurableObjectNamespaceLike;
  APP_ENV?: string;
  APP_VERSION?: string;
  JWT_SECRET?: string;
  SESSION_TTL_HOURS?: string;
  NODE_SYSTEM_SQLITE_PATH?: string;
  NODE_COMPANY_SQLITE_DIR?: string;
  ADMIN_ACCESS_TOKEN?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}

export interface RuntimeConfig {
  runtime: "node" | "cloudflare";
  appEnv: string;
  appVersion: string;
  jwtSecret: string;
  sessionTtlHours: number;
  nodeSystemSqlitePath: string;
  nodeCompanySqliteDir: string;
  adminAccessToken: string;
}
