export const preset = {
  key: "yearly_overtime_ledger_by_worker",
  name: "Yearly overtime ledger by worker",
  description: "Show a full-year month-by-month overtime ledger per worker with scheduled hours, worked hours, monthly balance, and running balance in company-local format.",
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
calendar_days(day) AS (
  SELECT year_start FROM year_bounds
  UNION ALL
  SELECT date(day, '+1 day')
  FROM calendar_days
  WHERE day < (SELECT year_end FROM year_bounds)
),
active_users AS (
  SELECT id AS user_id, full_name
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
    COALESCE(SUM(CASE WHEN b.start_time IS NOT NULL AND b.end_time IS NOT NULL THEN b.minutes ELSE 0 END), 0) AS planned_minutes
  FROM selected_day_contract sdc
  LEFT JOIN user_contract_schedule_blocks b
    ON b.contract_id = sdc.contract_id
   AND b.weekday = CASE strftime('%w', sdc.day)
      WHEN '0' THEN 7
      ELSE CAST(strftime('%w', sdc.day) AS INTEGER)
   END
  GROUP BY sdc.user_id, sdc.full_name, sdc.day, sdc.month_start, sdc.contract_id
),
worked_day AS (
  SELECT
    te.user_id,
    te.entry_date AS day,
    SUM(CASE
      WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
      THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 * 60.0
      ELSE 0
    END) AS worked_minutes,
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
    sd.planned_minutes,
    COALESCE(wd.worked_minutes, 0) AS worked_minutes,
    COALESCE(wd.work_entries, 0) AS work_entries,
    CASE WHEN h.date IS NOT NULL THEN 1 ELSE 0 END AS is_holiday,
    COALESCE(wd.worked_minutes, 0) - sd.planned_minutes AS balance_minutes
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
    SUM(CASE WHEN planned_minutes > 0 THEN 1 ELSE 0 END) AS planned_work_days,
    SUM(CASE WHEN worked_minutes > 0 THEN 1 ELSE 0 END) AS actual_work_days,
    SUM(is_holiday) AS holiday_days,
    SUM(work_entries) AS work_entries,
    SUM(planned_minutes) AS planned_minutes,
    SUM(worked_minutes) AS worked_minutes,
    SUM(balance_minutes) AS balance_minutes
  FROM daily
  GROUP BY user_id, full_name, month_start
)
SELECT
  strftime('%Y', ms.month_start) AS "Year",
  (
    CASE
      WHEN s.locale LIKE 'de%' THEN CASE strftime('%m', ms.month_start)
        WHEN '01' THEN 'Jan.'
        WHEN '02' THEN 'Feb.'
        WHEN '03' THEN 'Mar.'
        WHEN '04' THEN 'Apr.'
        WHEN '05' THEN 'Mai'
        WHEN '06' THEN 'Jun.'
        WHEN '07' THEN 'Jul.'
        WHEN '08' THEN 'Aug.'
        WHEN '09' THEN 'Sep.'
        WHEN '10' THEN 'Okt.'
        WHEN '11' THEN 'Nov.'
        ELSE 'Dez.'
      END
      ELSE CASE strftime('%m', ms.month_start)
        WHEN '01' THEN 'Jan.'
        WHEN '02' THEN 'Feb.'
        WHEN '03' THEN 'Mar.'
        WHEN '04' THEN 'Apr.'
        WHEN '05' THEN 'May'
        WHEN '06' THEN 'Jun.'
        WHEN '07' THEN 'Jul.'
        WHEN '08' THEN 'Aug.'
        WHEN '09' THEN 'Sep.'
        WHEN '10' THEN 'Oct.'
        WHEN '11' THEN 'Nov.'
        ELSE 'Dec.'
      END
    END || ' ' || strftime('%Y', ms.month_start)
  ) AS "Month",
  ms.full_name AS "Employee",
  CASE
    WHEN s.locale LIKE 'de%' THEN CASE strftime('%w', ms.month_first_day)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', ms.month_first_day)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  strftime('%d.%m.%Y', ms.month_first_day) AS "Month start",
  CASE
    WHEN s.locale LIKE 'de%' THEN CASE strftime('%w', ms.month_last_day)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', ms.month_last_day)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  strftime('%d.%m.%Y', ms.month_last_day) AS "Month end",
  CAST(ROUND(COALESCE(ms.planned_work_days, 0), 0) AS INTEGER) AS "Planned days",
  CAST(ROUND(COALESCE(ms.actual_work_days, 0), 0) AS INTEGER) AS "Worked days",
  CAST(ROUND(COALESCE(ms.holiday_days, 0), 0) AS INTEGER) AS "Holidays",
  CAST(ROUND(COALESCE(ms.work_entries, 0), 0) AS INTEGER) AS "Work entries",
  printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) % 60) AS "Scheduled hours",
  printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) % 60) AS "Worked hours",
  CASE WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE '' END ||
  printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60) AS "Monthly balance"
FROM month_summary ms
CROSS JOIN settings_ctx s
ORDER BY ms.month_start DESC, ms.full_name ASC
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
