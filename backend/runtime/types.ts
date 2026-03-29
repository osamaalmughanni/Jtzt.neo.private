import type Database from "better-sqlite3";
export type SqlValue = string | number | null;

export interface AppDatabase {
  sqlite: Database.Database;
  orm: any;
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
