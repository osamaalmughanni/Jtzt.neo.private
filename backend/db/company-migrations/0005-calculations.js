function hasTable(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

function hasColumn(db, tableName, columnName) {
  if (!hasTable(db, tableName)) {
    return false;
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

export async function up({ context: db }) {
  if (!hasTable(db, "calculations")) {
    db.exec(`
      CREATE TABLE calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sql_text TEXT NOT NULL,
        output_mode TEXT NOT NULL DEFAULT 'both' CHECK(output_mode IN ('table', 'chart', 'both')),
        chart_type TEXT NOT NULL DEFAULT 'bar' CHECK(chart_type IN ('bar', 'line', 'area', 'pie')),
        chart_category_column TEXT,
        chart_value_column TEXT,
        chart_series_column TEXT,
        chart_config_json TEXT NOT NULL DEFAULT '{}',
        chart_stacked INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_calculations_name ON calculations (lower(name))");
  } else {
    if (!hasColumn(db, "calculations", "chart_series_column")) {
      db.exec("ALTER TABLE calculations ADD COLUMN chart_series_column TEXT");
    }
    if (!hasColumn(db, "calculations", "chart_config_json")) {
      db.exec("ALTER TABLE calculations ADD COLUMN chart_config_json TEXT NOT NULL DEFAULT '{}'");
    }
  }

  if (!hasTable(db, "calculation_versions")) {
    db.exec(`
      CREATE TABLE calculation_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calculation_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        sql_text TEXT NOT NULL,
        output_mode TEXT NOT NULL,
        chart_type TEXT NOT NULL,
        chart_category_column TEXT,
        chart_value_column TEXT,
        chart_series_column TEXT,
        chart_config_json TEXT NOT NULL DEFAULT '{}',
        chart_stacked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (calculation_id) REFERENCES calculations(id) ON DELETE CASCADE,
        UNIQUE(calculation_id, version_number)
      )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_calculation_versions_calculation ON calculation_versions (calculation_id, version_number DESC)");
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
