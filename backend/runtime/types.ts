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

export interface RuntimeConfig {
  appEnv: string;
  appVersion: string;
  jwtSecret: string;
  sessionTtlHours: number;
  nodeSystemSqlitePath: string;
  nodeCompanySqliteDir: string;
  adminAccessToken: string;
}
