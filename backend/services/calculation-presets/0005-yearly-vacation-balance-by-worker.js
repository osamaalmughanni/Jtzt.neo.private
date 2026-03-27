export const preset = {
  key: "yearly_vacation_balance_by_worker",
  name: "Yearly vacation balance by worker",
  description: "Show the current year vacation entitlement, vacation taken, and remaining balance per worker in Austrian-style format.",
  sqlText: `
WITH RECURSIVE
year_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of year') AS year_start,
    date(datetime('now', 'localtime'), 'start of year', '+1 year') AS next_year,
    date(datetime('now', 'localtime'), 'start of year', '+1 year', '-1 day') AS year_end
),
contract_coverage AS (
  SELECT
    uc.user_id,
    uc.start_date,
    uc.end_date,
    uc.annual_vacation_days,
    MAX(uc.start_date, y.year_start) AS overlap_start,
    MIN(COALESCE(uc.end_date, y.year_end), y.year_end) AS overlap_end,
    (julianday(MIN(COALESCE(uc.end_date, y.year_end), y.year_end)) - julianday(MAX(uc.start_date, y.year_start)) + 1) AS overlap_days,
    (julianday(y.year_end) - julianday(y.year_start) + 1) AS year_days
  FROM user_contracts uc
  CROSS JOIN year_bounds y
  WHERE uc.start_date <= y.year_end
    AND (uc.end_date IS NULL OR uc.end_date >= y.year_start)
),
yearly_entitlement AS (
  SELECT
    user_id,
    ROUND(SUM(COALESCE(annual_vacation_days, 0) * (overlap_days / year_days)), 2) AS soll_urlaub
  FROM contract_coverage
  WHERE overlap_start <= overlap_end
  GROUP BY user_id
),
vacation_days AS (
  SELECT
    te.user_id,
    te.entry_date AS day,
    COALESCE(te.end_date, te.entry_date) AS end_day
  FROM time_entries te
  CROSS JOIN year_bounds y
  WHERE te.entry_type = 'vacation'
    AND te.entry_date <= y.year_end
    AND COALESCE(te.end_date, te.entry_date) >= y.year_start
  UNION ALL
  SELECT
    user_id,
    date(day, '+1 day'),
    end_day
  FROM vacation_days
  WHERE day < end_day
),
yearly_used AS (
  SELECT
    vd.user_id,
    COUNT(DISTINCT vd.day) AS ist_urlaub
  FROM vacation_days vd
  CROSS JOIN year_bounds y
  LEFT JOIN holidays h ON h.date = vd.day
  WHERE vd.day BETWEEN y.year_start AND y.year_end
    AND strftime('%w', vd.day) NOT IN ('0', '6')
    AND h.date IS NULL
  GROUP BY vd.user_id
)
SELECT
  strftime('%Y', y.year_start) AS "Jahr",
  CASE strftime('%w', y.year_start)
    WHEN '0' THEN 'So'
    WHEN '1' THEN 'Mo'
    WHEN '2' THEN 'Di'
    WHEN '3' THEN 'Mi'
    WHEN '4' THEN 'Do'
    WHEN '5' THEN 'Fr'
    ELSE 'Sa'
  END || ', ' || strftime('%d.%m.%Y', y.year_start) AS "Jahresbeginn",
  CASE strftime('%w', y.year_end)
    WHEN '0' THEN 'So'
    WHEN '1' THEN 'Mo'
    WHEN '2' THEN 'Di'
    WHEN '3' THEN 'Mi'
    WHEN '4' THEN 'Do'
    WHEN '5' THEN 'Fr'
    ELSE 'Sa'
  END || ', ' || strftime('%d.%m.%Y', y.year_end) AS "Jahresende",
  u.full_name AS "Mitarbeiter",
  CAST(ROUND(COALESCE(ent.soll_urlaub, 0), 0) AS INTEGER) || '' AS "Urlaubsanspruch",
  CAST(ROUND(COALESCE(used.ist_urlaub, 0), 0) AS INTEGER) || '' AS "Urlaub genommen",
  CAST(ROUND(MAX(COALESCE(ent.soll_urlaub, 0) - COALESCE(used.ist_urlaub, 0), 0), 0) AS INTEGER) || '' AS "Urlaub verfügbar",
  CAST(ROUND(COALESCE(ent.soll_urlaub, 0) - COALESCE(used.ist_urlaub, 0), 0) AS INTEGER) || '' AS "Resturlaub"
FROM users u
CROSS JOIN year_bounds y
LEFT JOIN yearly_entitlement ent ON ent.user_id = u.id
LEFT JOIN yearly_used used ON used.user_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY "Urlaub verfügbar" DESC, u.full_name ASC
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
