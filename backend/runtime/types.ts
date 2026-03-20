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

export interface D1ResultLike {
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
  results?: unknown[];
}

export interface D1PreparedStatementLike {
  bind(...values: SqlValue[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1ResultLike>;
}

export interface D1QueryableLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}

export interface D1DatabaseSessionLike extends D1QueryableLike {
  getBookmark(): string | null;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
  exec(query: string): Promise<unknown>;
  withSession(bookmarkOrConstraint?: string): D1DatabaseSessionLike;
}

export interface RuntimeBindings {
  DB?: D1DatabaseLike;
  APP_ENV?: string;
  APP_VERSION?: string;
  JWT_SECRET?: string;
  SESSION_TTL_HOURS?: string;
  NODE_SQLITE_PATH?: string;
  ADMIN_ACCESS_TOKEN?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}

export interface RuntimeConfig {
  runtime: "node" | "cloudflare";
  appEnv: string;
  appVersion: string;
  jwtSecret: string;
  sessionTtlHours: number;
  nodeSqlitePath: string;
  adminAccessToken: string;
}
