import type Database from "better-sqlite3";
export type SqlValue = string | number | null;

export interface AppDatabase {
  orm: any;
}

export interface NodeSqliteDatabase {
  sqlite: Database.Database;
}

export type NodeDatabase = AppDatabase & NodeSqliteDatabase;

export interface RuntimeConfig {
  appEnv: string;
  appVersion: string;
  jwtSecret: string;
  sessionTtlHours: number;
  nodeSystemSqlitePath: string;
  nodeCompanySqliteDir: string;
  adminAccessToken: string;
}
