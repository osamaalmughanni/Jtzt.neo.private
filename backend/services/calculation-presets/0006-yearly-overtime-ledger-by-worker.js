export const preset = {
  key: "yearly_overtime_ledger_by_worker",
  name: "Yearly overtime ledger by worker",
  description:
    "Show a full-year month-by-month overtime ledger per worker with scheduled hours, worked hours, monthly balance, and running balance in Austrian-style format.",
  sqlText: `
WITH RECURSIVE
year_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of year') AS year_start,
    date(datetime('now', 'localtime'), 'start of year', '+1 year', '-1 day') AS year_end
),
months(month_start) AS (
  SELECT year_start FROM year_bounds
  UNION ALL
  SELECT date(month_start, '+1 month')
  FROM months
  WHERE month_start < date((SELECT year_start FROM year_bounds), '+11 months')
),
month_bounds AS (
  SELECT
    month_start,
    date(month_start, '+1 month', '-1 day') AS month_end
  FROM months
),
calendar_days(day) AS (
  SELECT year_start FROM year_bounds
  UNION ALL
  SELECT date(day, '+1 day')
  FROM calendar_days
  WHERE day < (SELECT year_end FROM year_bounds)
),
active_users AS (
  SELECT
    id AS user_id,
    full_name
  FROM users
  WHERE deleted_at IS NULL
),
user_days AS (
  SELECT
    u.user_id,
    u.full_name,
    d.day,
    date(d.day, 'start of month') AS month_start
  FROM active_users u
  CROSS JOIN calendar_days d
),
day_contracts AS (
  SELECT
    ud.user_id,
    ud.full_name,
    ud.day,
    ud.month_start,
    uc.id AS contract_id,
    uc.start_date,
    uc.end_date,
    ROW_NUMBER() OVER (
      PARTITION BY ud.user_id, ud.day
      ORDER BY uc.start_date DESC, uc.id DESC
    ) AS rn
  FROM user_days ud
  LEFT JOIN user_contracts uc
    ON uc.user_id = ud.user_id
   AND uc.start_date <= ud.day
   AND (uc.end_date IS NULL OR uc.end_date >= ud.day)
),
selected_day_contract AS (
  SELECT *
  FROM day_contracts
  WHERE rn = 1
),
scheduled_day AS (
  SELECT
    sdc.user_id,
    sdc.full_name,
    sdc.day,
    sdc.month_start,
    sdc.contract_id,
    sdc.start_date,
    sdc.end_date,
    COALESCE(SUM(CASE WHEN b.start_time IS NOT NULL AND b.end_time IS NOT NULL THEN b.minutes ELSE 0 END), 0) AS planned_minutes
  FROM selected_day_contract sdc
  LEFT JOIN user_contract_schedule_blocks b
    ON b.contract_id = sdc.contract_id
   AND b.weekday = CASE strftime('%w', sdc.day)
      WHEN '0' THEN 7
      ELSE CAST(strftime('%w', sdc.day) AS INTEGER)
   END
  GROUP BY
    sdc.user_id,
    sdc.full_name,
    sdc.day,
    sdc.month_start,
    sdc.contract_id,
    sdc.start_date,
    sdc.end_date
),
worked_day AS (
  SELECT
    te.user_id,
    te.entry_date AS day,
    SUM(
      CASE
        WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
        THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 * 60.0
        ELSE 0
      END
    ) AS worked_minutes,
    COUNT(DISTINCT CASE WHEN te.entry_type = 'work' THEN te.id END) AS work_entries
  FROM time_entries te
  CROSS JOIN year_bounds y
  WHERE te.entry_date BETWEEN y.year_start AND y.year_end
  GROUP BY te.user_id, te.entry_date
),
daily AS (
  SELECT
    sd.user_id,
    sd.full_name,
    sd.day,
    sd.month_start,
    sd.contract_id,
    sd.start_date,
    sd.end_date,
    sd.planned_minutes,
    COALESCE(wd.worked_minutes, 0) AS worked_minutes,
    COALESCE(wd.work_entries, 0) AS work_entries,
    CASE WHEN h.date IS NOT NULL THEN 1 ELSE 0 END AS is_holiday,
    (COALESCE(wd.worked_minutes, 0) - sd.planned_minutes) AS balance_minutes
  FROM scheduled_day sd
  LEFT JOIN worked_day wd
    ON wd.user_id = sd.user_id
   AND wd.day = sd.day
  LEFT JOIN holidays h
    ON h.date = sd.day
),
month_summary AS (
  SELECT
    user_id,
    full_name,
    month_start,
    MIN(day) AS month_first_day,
    MAX(day) AS month_last_day,
    COUNT(DISTINCT contract_id) AS contract_count,
    SUM(CASE WHEN planned_minutes > 0 THEN 1 ELSE 0 END) AS planned_work_days,
    SUM(CASE WHEN worked_minutes > 0 THEN 1 ELSE 0 END) AS actual_work_days,
    SUM(is_holiday) AS holiday_days,
    SUM(work_entries) AS work_entries,
    SUM(planned_minutes) AS planned_minutes,
    SUM(worked_minutes) AS worked_minutes,
    SUM(balance_minutes) AS balance_minutes
  FROM daily
  GROUP BY user_id, full_name, month_start
),
monthly_rows AS (
  SELECT
    1 AS sort_group,
    ms.user_id,
    ms.month_start AS sort_date,
    strftime('%Y', ms.month_start) AS "Jahr",
    CASE strftime('%m', ms.month_start)
      WHEN '01' THEN 'Jänner'
      WHEN '02' THEN 'Februar'
      WHEN '03' THEN 'März'
      WHEN '04' THEN 'April'
      WHEN '05' THEN 'Mai'
      WHEN '06' THEN 'Juni'
      WHEN '07' THEN 'Juli'
      WHEN '08' THEN 'August'
      WHEN '09' THEN 'September'
      WHEN '10' THEN 'Oktober'
      WHEN '11' THEN 'November'
      ELSE 'Dezember'
    END || ' ' || strftime('%Y', ms.month_start) AS "Monat",
    ms.full_name AS "Mitarbeiter",
    CASE strftime('%w', ms.month_first_day)
      WHEN '0' THEN 'So'
      WHEN '1' THEN 'Mo'
      WHEN '2' THEN 'Di'
      WHEN '3' THEN 'Mi'
      WHEN '4' THEN 'Do'
      WHEN '5' THEN 'Fr'
      ELSE 'Sa'
    END || ', ' || strftime('%d.%m.%Y', ms.month_first_day) AS "Monatsbeginn",
    CASE strftime('%w', ms.month_last_day)
      WHEN '0' THEN 'So'
      WHEN '1' THEN 'Mo'
      WHEN '2' THEN 'Di'
      WHEN '3' THEN 'Mi'
      WHEN '4' THEN 'Do'
      WHEN '5' THEN 'Fr'
      ELSE 'Sa'
    END || ', ' || strftime('%d.%m.%Y', ms.month_last_day) AS "Monatsende",
    CAST(ROUND(COALESCE(ms.contract_count, 0), 0) AS INTEGER) || '' AS "Verträge",
    CAST(ROUND(COALESCE(ms.planned_work_days, 0), 0) AS INTEGER) || '' AS "Solltage",
    CAST(ROUND(COALESCE(ms.actual_work_days, 0), 0) AS INTEGER) || '' AS "Istarbeitstage",
    CAST(ROUND(COALESCE(ms.holiday_days, 0), 0) AS INTEGER) || '' AS "Feiertage",
    CAST(ROUND(COALESCE(ms.work_entries, 0), 0) AS INTEGER) || '' AS "Arbeitseinträge",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Sollstunden",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Iststunden",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Monatssaldo",
    CASE
      WHEN CAST(ROUND(
        SUM(COALESCE(ms.balance_minutes, 0)) OVER (
          PARTITION BY ms.user_id
          ORDER BY ms.month_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ), 0
      ) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(
        SUM(COALESCE(ms.balance_minutes, 0)) OVER (
          PARTITION BY ms.user_id
          ORDER BY ms.month_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ), 0
      ) AS INTEGER)) / 60,
      ABS(CAST(ROUND(
        SUM(COALESCE(ms.balance_minutes, 0)) OVER (
          PARTITION BY ms.user_id
          ORDER BY ms.month_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ), 0
      ) AS INTEGER)) % 60
    ) AS "Saldo kumuliert",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) > 0 THEN
        '+' || printf(
          '%d:%02d h',
          CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) / 60,
          CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) % 60
        )
      ELSE '0:00 h'
    END AS "Plusstunden",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN
        '-' || printf(
          '%d:%02d h',
          ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60,
          ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60
        )
      ELSE '0:00 h'
    END AS "Minusstunden"
  FROM month_summary ms
),
yearly_rows AS (
  SELECT
    2 AS sort_group,
    ms.user_id,
    (SELECT year_start FROM year_bounds) AS sort_date,
    strftime('%Y', y.year_start) AS "Jahr",
    'Gesamtjahr ' || strftime('%Y', y.year_start) AS "Monat",
    ms.full_name AS "Mitarbeiter",
    CASE strftime('%w', y.year_start)
      WHEN '0' THEN 'So'
      WHEN '1' THEN 'Mo'
      WHEN '2' THEN 'Di'
      WHEN '3' THEN 'Mi'
      WHEN '4' THEN 'Do'
      WHEN '5' THEN 'Fr'
      ELSE 'Sa'
    END || ', ' || strftime('%d.%m.%Y', y.year_start) AS "Monatsbeginn",
    CASE strftime('%w', y.year_end)
      WHEN '0' THEN 'So'
      WHEN '1' THEN 'Mo'
      WHEN '2' THEN 'Di'
      WHEN '3' THEN 'Mi'
      WHEN '4' THEN 'Do'
      WHEN '5' THEN 'Fr'
      ELSE 'Sa'
    END || ', ' || strftime('%d.%m.%Y', y.year_end) AS "Monatsende",
    CAST(ROUND(COALESCE((SELECT COUNT(DISTINCT d.contract_id) FROM daily d WHERE d.user_id = ms.user_id AND d.contract_id IS NOT NULL), 0), 0) AS INTEGER) || '' AS "Verträge",
    CAST(ROUND(COALESCE(SUM(ms.planned_work_days), 0), 0) AS INTEGER) || '' AS "Solltage",
    CAST(ROUND(COALESCE(SUM(ms.actual_work_days), 0), 0) AS INTEGER) || '' AS "Istarbeitstage",
    CAST(ROUND(COALESCE(SUM(ms.holiday_days), 0), 0) AS INTEGER) || '' AS "Feiertage",
    CAST(ROUND(COALESCE(SUM(ms.work_entries), 0), 0) AS INTEGER) || '' AS "Arbeitseinträge",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.planned_minutes), 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(SUM(ms.planned_minutes), 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(SUM(ms.planned_minutes), 0), 0) AS INTEGER)) % 60
    ) AS "Sollstunden",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.worked_minutes), 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(SUM(ms.worked_minutes), 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(SUM(ms.worked_minutes), 0), 0) AS INTEGER)) % 60
    ) AS "Iststunden",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) % 60
    ) AS "Monatssaldo",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) % 60
    ) AS "Saldo kumuliert",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) > 0 THEN
        '+' || printf(
          '%d:%02d h',
          CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) / 60,
          CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) % 60
        )
      ELSE '0:00 h'
    END AS "Plusstunden",
    CASE
      WHEN CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER) < 0 THEN
        '-' || printf(
          '%d:%02d h',
          ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) / 60,
          ABS(CAST(ROUND(COALESCE(SUM(ms.balance_minutes), 0), 0) AS INTEGER)) % 60
        )
      ELSE '0:00 h'
    END AS "Minusstunden"
  FROM month_summary ms
  CROSS JOIN year_bounds y
  GROUP BY ms.user_id, ms.full_name
)
SELECT
  "Jahr",
  "Monat",
  "Mitarbeiter",
  "Monatsbeginn",
  "Monatsende",
  "Verträge",
  "Solltage",
  "Istarbeitstage",
  "Feiertage",
  "Arbeitseinträge",
  "Sollstunden",
  "Iststunden",
  "Monatssaldo",
  "Saldo kumuliert",
  "Plusstunden",
  "Minusstunden"
FROM (
  SELECT * FROM monthly_rows
  UNION ALL
  SELECT * FROM yearly_rows
)
ORDER BY sort_group, sort_date, "Mitarbeiter"
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
