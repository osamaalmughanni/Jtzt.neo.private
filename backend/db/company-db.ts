import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { appConfig } from "../config";
import { companySchema } from "./schema";

const companyConnections = new Map<string, Database.Database>();

type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyMigrations(db: Database.Database, migrations: Migration[]) {
  ensureMigrationTable(db);

  for (const migration of migrations) {
    const existing = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(migration.id);
    if (existing) {
      continue;
    }

    const transaction = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date().toISOString());
    });

    transaction();
  }
}

function columnExists(db: Database.Database, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(db: Database.Database, tableName: string, columnSql: string, columnName: string) {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

const companyMigrations: Migration[] = [
  {
    id: "001_company_core",
    up(db) {
      db.exec(companySchema);
    }
  },
  {
    id: "002_user_profile_contract_fields",
    up(db) {
      addColumnIfMissing(db, "users", "pin_code TEXT NOT NULL DEFAULT '0000'", "pin_code");
      addColumnIfMissing(db, "users", "email TEXT", "email");
      addColumnIfMissing(db, "users", "contract_hours_per_week REAL", "contract_hours_per_week");
      addColumnIfMissing(db, "users", "contract_start_date TEXT", "contract_start_date");
      addColumnIfMissing(db, "users", "contract_end_date TEXT", "contract_end_date");
      addColumnIfMissing(db, "users", "contract_payment_per_hour REAL", "contract_payment_per_hour");
    }
  },
  {
    id: "003_user_pictures_and_contracts_table",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          hours_per_week REAL NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          payment_per_hour REAL NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

      const rows = db
        .prepare(
          `SELECT
            id,
            contract_hours_per_week,
            contract_start_date,
            contract_end_date,
            contract_payment_per_hour,
            created_at
          FROM users
          WHERE contract_hours_per_week IS NOT NULL
            AND contract_start_date IS NOT NULL
            AND contract_end_date IS NOT NULL
            AND contract_payment_per_hour IS NOT NULL`
        )
        .all() as Array<{
          id: number;
          contract_hours_per_week: number;
          contract_start_date: string;
          contract_end_date: string;
          contract_payment_per_hour: number;
          created_at: string;
        }>;

      const insertContract = db.prepare(
        `INSERT INTO user_contracts (
          user_id,
          hours_per_week,
          start_date,
          end_date,
          payment_per_hour,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const row of rows) {
        const exists = db
          .prepare(
            `SELECT id FROM user_contracts
            WHERE user_id = ?
              AND start_date = ?
              AND end_date = ?`
          )
          .get(row.id, row.contract_start_date, row.contract_end_date);

        if (!exists) {
          insertContract.run(
            row.id,
            row.contract_hours_per_week,
            row.contract_start_date,
            row.contract_end_date,
            row.contract_payment_per_hour,
            row.created_at
          );
        }
      }
    }
  },
  {
    id: "004_company_settings_manual_time",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS company_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          currency TEXT NOT NULL DEFAULT 'EUR',
          locale TEXT NOT NULL DEFAULT 'en-GB',
          time_zone TEXT NOT NULL DEFAULT 'Europe/Vienna',
          date_time_format TEXT NOT NULL DEFAULT 'g',
          first_day_of_week INTEGER NOT NULL DEFAULT 1,
          edit_days_limit INTEGER NOT NULL DEFAULT 30,
          insert_days_limit INTEGER NOT NULL DEFAULT 30,
          allow_one_record_per_day INTEGER NOT NULL DEFAULT 0,
          allow_intersecting_records INTEGER NOT NULL DEFAULT 0,
          country TEXT NOT NULL DEFAULT 'AT',
          tablet_idle_timeout_seconds INTEGER NOT NULL DEFAULT 10,
          auto_break_after_minutes INTEGER NOT NULL DEFAULT 300,
          auto_break_duration_minutes INTEGER NOT NULL DEFAULT 30,
          custom_fields_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS public_holiday_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          country_code TEXT NOT NULL,
          year INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          UNIQUE(country_code, year)
        );
      `);

      db.prepare(
        `INSERT INTO company_settings (
          id,
          currency,
          locale,
          time_zone,
          date_time_format,
          first_day_of_week,
          edit_days_limit,
          insert_days_limit,
          allow_one_record_per_day,
          allow_intersecting_records,
          country,
          auto_break_after_minutes,
          auto_break_duration_minutes,
          custom_fields_json
        ) VALUES (1, 'EUR', 'en-GB', 'Europe/Vienna', 'g', 1, 30, 30, 0, 0, 'AT', 300, 30, '[]')
        ON CONFLICT(id) DO NOTHING`
      ).run();
    }
  },
  {
    id: "006_settings_country_column",
    up(db) {
      addColumnIfMissing(db, "company_settings", "country TEXT NOT NULL DEFAULT 'AT'", "country");
      if (columnExists(db, "company_settings", "holiday_country")) {
        db.exec("UPDATE company_settings SET country = COALESCE(country, holiday_country)");
      }
    }
  },
  {
    id: "007_user_active_status",
    up(db) {
      addColumnIfMissing(db, "users", "is_active INTEGER NOT NULL DEFAULT 1", "is_active");
    }
  },
  {
    id: "008_contract_end_date_nullable",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_contracts_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          hours_per_week REAL NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT,
          payment_per_hour REAL NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        INSERT INTO user_contracts_next (
          id,
          user_id,
          hours_per_week,
          start_date,
          end_date,
          payment_per_hour,
          created_at
        )
        SELECT
          id,
          user_id,
          hours_per_week,
          start_date,
          end_date,
          payment_per_hour,
          created_at
        FROM user_contracts;

        DROP TABLE user_contracts;
        ALTER TABLE user_contracts_next RENAME TO user_contracts;
      `);
    }
  },
  {
    id: "009_time_entries_types_and_ranges",
    up(db) {
      addColumnIfMissing(
        db,
        "time_entries",
        "entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'vacation', 'sick_leave'))",
        "entry_type"
      );
      addColumnIfMissing(db, "time_entries", "entry_date TEXT", "entry_date");
      addColumnIfMissing(db, "time_entries", "end_date TEXT", "end_date");
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_name TEXT", "sick_leave_attachment_name");
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_mime_type TEXT", "sick_leave_attachment_mime_type");
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_data_url TEXT", "sick_leave_attachment_data_url");
      db.exec(`
        UPDATE time_entries
        SET entry_date = COALESCE(entry_date, substr(start_time, 1, 10))
        WHERE entry_date IS NULL;

        CREATE INDEX IF NOT EXISTS idx_time_entries_user_day
        ON time_entries (user_id, entry_date, end_date);

        CREATE INDEX IF NOT EXISTS idx_time_entries_user_type_day
        ON time_entries (user_id, entry_type, entry_date, end_date);
      `);
    }
  },
  {
    id: "010_time_entry_sick_leave_attachments",
    up(db) {
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_name TEXT", "sick_leave_attachment_name");
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_mime_type TEXT", "sick_leave_attachment_mime_type");
      addColumnIfMissing(db, "time_entries", "sick_leave_attachment_data_url TEXT", "sick_leave_attachment_data_url");
    }
  },
  {
    id: "011_company_custom_fields",
    up(db) {
      addColumnIfMissing(db, "company_settings", "custom_fields_json TEXT NOT NULL DEFAULT '[]'", "custom_fields_json");
      addColumnIfMissing(db, "time_entries", "custom_field_values_json TEXT NOT NULL DEFAULT '{}'", "custom_field_values_json");
    }
  },
  {
    id: "012_company_date_time_format",
    up(db) {
      addColumnIfMissing(db, "company_settings", "date_time_format TEXT NOT NULL DEFAULT 'g'", "date_time_format");
    }
  },
  {
    id: "013_company_auto_break_settings",
    up(db) {
      addColumnIfMissing(db, "company_settings", "auto_break_after_minutes INTEGER NOT NULL DEFAULT 300", "auto_break_after_minutes");
      addColumnIfMissing(db, "company_settings", "auto_break_duration_minutes INTEGER NOT NULL DEFAULT 30", "auto_break_duration_minutes");
    }
  },
  {
    id: "014_company_tablet_idle_timeout",
    up(db) {
      addColumnIfMissing(db, "company_settings", "tablet_idle_timeout_seconds INTEGER NOT NULL DEFAULT 10", "tablet_idle_timeout_seconds");
    }
  },
  {
    id: "015_company_allow_one_record_per_day",
    up(db) {
      addColumnIfMissing(db, "company_settings", "allow_one_record_per_day INTEGER NOT NULL DEFAULT 0", "allow_one_record_per_day");
    }
  },
  {
    id: "016_company_allow_intersecting_records",
    up(db) {
      addColumnIfMissing(db, "company_settings", "allow_intersecting_records INTEGER NOT NULL DEFAULT 0", "allow_intersecting_records");
    }
  },
  {
    id: "017_company_time_zone",
    up(db) {
      addColumnIfMissing(db, "company_settings", "time_zone TEXT NOT NULL DEFAULT 'Europe/Vienna'", "time_zone");
      db.exec("UPDATE company_settings SET time_zone = COALESCE(NULLIF(TRIM(time_zone), ''), 'Europe/Vienna')");
    }
  },
  {
    id: "005_user_roles_admin_manager_employee",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'admin')),
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          pin_code TEXT NOT NULL DEFAULT '0000',
          email TEXT,
          contract_hours_per_week REAL,
          contract_start_date TEXT,
          contract_end_date TEXT,
          contract_payment_per_hour REAL
        );

        INSERT INTO users_next (
          id,
          username,
          full_name,
          password_hash,
          role,
          is_active,
          created_at,
          pin_code,
          email,
          contract_hours_per_week,
          contract_start_date,
          contract_end_date,
          contract_payment_per_hour
        )
        SELECT
          id,
          username,
          full_name,
          password_hash,
          CASE
            WHEN role = 'company_admin' THEN 'admin'
            WHEN role = 'manager' THEN 'manager'
            WHEN role = 'admin' THEN 'admin'
            ELSE 'employee'
          END,
          COALESCE(is_active, 1),
          created_at,
          COALESCE(pin_code, '0000'),
          email,
          contract_hours_per_week,
          contract_start_date,
          contract_end_date,
          contract_payment_per_hour
        FROM users;

        DROP TABLE users;
        ALTER TABLE users_next RENAME TO users;
      `);
    }
  }
];

export function sanitizeCompanySlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function createCompanyDbPath(companyName: string): string {
  return path.resolve(appConfig.dataDir, `company_${sanitizeCompanySlug(companyName)}.db`);
}

export function initializeCompanyDatabase(databasePath: string): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  applyMigrations(db, companyMigrations);
  return db;
}

export function getCompanyDb(databasePath: string): Database.Database {
  const cached = companyConnections.get(databasePath);
  if (cached) {
    return cached;
  }

  const db = initializeCompanyDatabase(databasePath);
  companyConnections.set(databasePath, db);
  return db;
}

export function closeCompanyDb(databasePath: string): void {
  const db = companyConnections.get(databasePath);
  if (!db) {
    return;
  }

  db.close();
  companyConnections.delete(databasePath);
}

export function seedCompanyAdmin(
  databasePath: string,
  payload: { username: string; password: string; fullName: string }
): void {
  seedCompanyUser(databasePath, {
    username: payload.username,
    password: payload.password,
    fullName: payload.fullName,
    role: "admin"
  });
}

export function seedCompanyUser(
  databasePath: string,
  payload: { username: string; password: string; fullName: string; role: "employee" | "manager" | "admin" }
): number {
  const db = getCompanyDb(databasePath);
  const result = db
    .prepare(
      "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (@username, @fullName, @passwordHash, @role, @createdAt)"
    )
    .run({
      username: payload.username,
      fullName: payload.fullName,
      passwordHash: bcrypt.hashSync(payload.password, 10),
      role: payload.role,
      createdAt: new Date().toISOString()
    });

  return Number(result.lastInsertRowid);
}

export function seedDefaultProjects(databasePath: string): void {
  void databasePath;
}
