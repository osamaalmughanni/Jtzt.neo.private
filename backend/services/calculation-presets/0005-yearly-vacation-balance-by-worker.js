export const preset = {
  key: "yearly_vacation_balance_by_worker",
  name: "Yearly vacation balance by worker",
  description: "Show the current year vacation entitlement, vacation taken, and remaining balance per worker in company-local format.",
  sqlText: `
WITH RECURSIVE
settings_ctx AS (
  SELECT
    COALESCE(NULLIF(locale, ''), 'de-AT') AS locale
  FROM company_settings
  LIMIT 1
),
year_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of year') AS year_start,
    date(datetime('now', 'localtime'), 'start of year', '+1 year', '-1 day') AS year_end
),
contract_coverage AS (
  SELECT
    uc.user_id,
    uc.annual_vacation_days,
    MAX(uc.start_date, y.year_start) AS overlap_start,
    MIN(COALESCE(uc.end_date, y.year_end), y.year_end) AS overlap_end,
    julianday(MIN(COALESCE(uc.end_date, y.year_end), y.year_end)) - julianday(MAX(uc.start_date, y.year_start)) + 1 AS overlap_days,
    julianday(y.year_end) - julianday(y.year_start) + 1 AS year_days
  FROM user_contracts uc
  CROSS JOIN year_bounds y
  WHERE uc.start_date <= y.year_end
    AND (uc.end_date IS NULL OR uc.end_date >= y.year_start)
),
yearly_entitlement AS (
  SELECT
    user_id,
    ROUND(SUM(COALESCE(annual_vacation_days, 0) * (overlap_days / year_days)), 2) AS entitled_days
  FROM contract_coverage
  WHERE overlap_start <= overlap_end
  GROUP BY user_id
),
vacation_days(user_id, day, end_day) AS (
  SELECT
    te.user_id,
    te.entry_date,
    COALESCE(te.end_date, te.entry_date)
  FROM time_entries te
  CROSS JOIN year_bounds y
  WHERE te.entry_type = 'vacation'
    AND te.entry_date <= y.year_end
    AND COALESCE(te.end_date, te.entry_date) >= y.year_start
  UNION ALL
  SELECT user_id, date(day, '+1 day'), end_day
  FROM vacation_days
  WHERE day < end_day
),
yearly_used AS (
  SELECT
    vd.user_id,
    COUNT(DISTINCT vd.day) AS taken_days
  FROM vacation_days vd
  CROSS JOIN year_bounds y
  LEFT JOIN holidays h ON h.date = vd.day
  LEFT JOIN company_settings cs ON 1 = 1
  WHERE vd.day BETWEEN y.year_start AND y.year_end
    AND h.date IS NULL
    AND instr(',' || COALESCE(REPLACE(cs.weekend_days_json, ' ', ''), '[6,7]') || ',', ',' ||
      CASE strftime('%w', vd.day) WHEN '0' THEN '7' ELSE strftime('%w', vd.day) END || ',') = 0
  GROUP BY vd.user_id
)
SELECT
  strftime('%Y', y.year_start) AS "Year",
  CASE
    WHEN s.locale LIKE 'de%' THEN CASE strftime('%w', y.year_start)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', y.year_start)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  strftime('%d.%m.%Y', y.year_start) AS "Year start",
  CASE
    WHEN s.locale LIKE 'de%' THEN CASE strftime('%w', y.year_end)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', y.year_end)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  strftime('%d.%m.%Y', y.year_end) AS "Year end",
  u.full_name AS "Employee",
  CAST(ROUND(COALESCE(ent.entitled_days, 0), 0) AS INTEGER) AS "Vacation entitlement",
  CAST(ROUND(COALESCE(used.taken_days, 0), 0) AS INTEGER) AS "Vacation taken",
  CAST(ROUND(MAX(COALESCE(ent.entitled_days, 0) - COALESCE(used.taken_days, 0), 0), 0) AS INTEGER) AS "Vacation available",
  CAST(ROUND(COALESCE(ent.entitled_days, 0) - COALESCE(used.taken_days, 0), 0) AS INTEGER) AS "Remaining vacation"
FROM users u
CROSS JOIN year_bounds y
CROSS JOIN settings_ctx s
LEFT JOIN yearly_entitlement ent ON ent.user_id = u.id
LEFT JOIN yearly_used used ON used.user_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY "Vacation available" DESC, u.full_name ASC
`.trim(),
  outputMode: "table",
  chartConfig: {
    type: "bar",
    categoryColumn: null,
    valueColumn: null,
    seriesColumn: null,
    stacked: false,
  },
};

export default preset;
