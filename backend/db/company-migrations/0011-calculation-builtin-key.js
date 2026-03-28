function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

export async function up({ context: db }) {
  if (!hasColumn(db, "calculations", "builtin_key")) {
    db.exec("ALTER TABLE calculations ADD COLUMN builtin_key TEXT");
  }

  db.exec(`
    UPDATE calculations
       SET builtin_key = CASE name
         WHEN 'Austrian monthly overtime by worker' THEN 'austrian_monthly_overtime_by_worker'
         WHEN 'Yearly vacation balance by worker' THEN 'yearly_vacation_balance_by_worker'
         WHEN 'Yearly overtime ledger by worker' THEN 'yearly_overtime_ledger_by_worker'
         ELSE builtin_key
       END
     WHERE is_builtin = 1 AND builtin_key IS NULL
  `);
}
