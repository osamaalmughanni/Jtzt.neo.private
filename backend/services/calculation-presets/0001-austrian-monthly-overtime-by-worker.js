export const preset = {
  key: "austrian_monthly_overtime_by_worker",
  name: "Austrian monthly overtime by worker",
  description: "Show monthly overtime, contract hours, and payroll impact per worker using company-local formatting.",
  sqlText: `
WITH RECURSIVE
settings_ctx AS (
  SELECT
    COALESCE(NULLIF(locale, ''), 'de-AT') AS locale,
    COALESCE(NULLIF(date_time_format, ''), 'dd.MM.yyyy HH:mm') AS date_time_format,
    COALESCE(NULLIF(currency, ''), 'EUR') AS currency
  FROM company_settings
  LIMIT 1
),
format_ctx AS (
  SELECT
    locale,
    currency,
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(date_time_format, 'yyyy', '@1@'),
                            'yy', '@2@'
                          ),
                          'dd', '@3@'
                        ),
                        'd', '@4@'
                      ),
                      'MM', '@5@'
                    ),
                    'M', '@6@'
                  ),
                  'HH', '@7@'
                ),
                'H', '@8@'
              ),
              'hh', '@9@'
            ),
            'h', '@10@'
          ),
          'mm', '@11@'
        ),
        'm', '@12@'
      ),
      'tt', '@13@'
    ) AS date_template,
    CASE
      WHEN locale LIKE 'de%' OR locale LIKE 'fr%' OR locale LIKE 'it%' OR locale LIKE 'es%' OR locale LIKE 'nl%' OR locale LIKE 'pt%' THEN ','
      ELSE '.'
    END AS decimal_mark,
    CASE
      WHEN locale LIKE 'de-CH%' OR locale LIKE 'fr-CH%' THEN ''''
      WHEN locale LIKE 'de%' OR locale LIKE 'fr%' OR locale LIKE 'it%' OR locale LIKE 'es%' OR locale LIKE 'nl%' OR locale LIKE 'pt%' THEN '.'
      ELSE ','
    END AS group_mark
  FROM settings_ctx
),
month_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of month') AS month_start,
    date(datetime('now', 'localtime'), 'start of month', '+1 month', '-1 day') AS month_end
),
active_users AS (
  SELECT id AS user_id
  FROM users
  WHERE deleted_at IS NULL AND is_active = 1
),
active_contracts AS (
  SELECT * FROM (
    SELECT
      uc.*,
      ROW_NUMBER() OVER (PARTITION BY uc.user_id ORDER BY uc.start_date DESC, uc.id DESC) AS rn
    FROM user_contracts uc
    INNER JOIN active_users au ON au.user_id = uc.user_id
    CROSS JOIN month_bounds mb
    WHERE uc.start_date <= mb.month_end
      AND (uc.end_date IS NULL OR uc.end_date >= mb.month_start)
  ) ranked
  WHERE rn = 1
),
daily_metrics AS (
  SELECT
    ac.user_id,
    te.entry_date,
    SUM(CASE
      WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
      THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0
      ELSE 0
    END) AS worked_hours,
    strftime('%w', te.entry_date) AS weekday,
    EXISTS(SELECT 1 FROM holidays h WHERE h.date = te.entry_date) AS is_holiday
  FROM active_contracts ac
  JOIN time_entries te ON te.user_id = ac.user_id
  CROSS JOIN month_bounds mb
  WHERE te.entry_date BETWEEN mb.month_start AND mb.month_end
  GROUP BY ac.user_id, te.entry_date
),
contract_totals AS (
  SELECT
    ac.id AS contract_id,
    ac.user_id,
    ac.start_date AS contract_start,
    ac.end_date AS contract_end,
    ac.payment_per_hour AS hourly_rate,
    ac.hours_per_week AS weekly_hours,
    ac.hours_per_week * 4.33 AS target_hours,
    COALESCE(SUM(dm.worked_hours), 0) AS total_hours,
    COALESCE(SUM(CASE WHEN dm.weekday = '0' OR dm.is_holiday THEN dm.worked_hours ELSE 0 END), 0) AS holiday_hours,
    COALESCE(SUM(CASE WHEN dm.weekday != '0' AND NOT dm.is_holiday THEN dm.worked_hours ELSE 0 END), 0) AS weekday_hours
  FROM active_contracts ac
  LEFT JOIN daily_metrics dm ON dm.user_id = ac.user_id
  GROUP BY ac.id, ac.user_id, ac.start_date, ac.end_date, ac.payment_per_hour, ac.hours_per_week
)
SELECT
  CASE
    WHEN f.locale LIKE 'de%' THEN CASE strftime('%w', mb.month_start)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', mb.month_start)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(f.date_template,
    '@1@', strftime('%Y', mb.month_start)),
    '@2@', substr(strftime('%Y', mb.month_start), 3, 2)),
    '@3@', strftime('%d', mb.month_start)),
    '@4@', CAST(CAST(strftime('%d', mb.month_start) AS INTEGER) AS TEXT)),
    '@5@', strftime('%m', mb.month_start)),
    '@6@', CAST(CAST(strftime('%m', mb.month_start) AS INTEGER) AS TEXT)),
    '@7@', strftime('%H', mb.month_start)),
    '@8@', CAST(CAST(strftime('%H', mb.month_start) AS INTEGER) AS TEXT)),
    '@9@', printf('%02d', CASE CAST(strftime('%H', mb.month_start) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', mb.month_start) AS INTEGER) % 12 END)),
    '@10@', CAST(CASE CAST(strftime('%H', mb.month_start) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', mb.month_start) AS INTEGER) % 12 END AS TEXT)),
    '@11@', strftime('%M', mb.month_start)),
    '@12@', CAST(CAST(strftime('%M', mb.month_start) AS INTEGER) AS TEXT)),
    '@13@', CASE WHEN CAST(strftime('%H', mb.month_start) AS INTEGER) < 12 THEN 'AM' ELSE 'PM' END) AS "Month start",
  CASE
    WHEN f.locale LIKE 'de%' THEN CASE strftime('%w', mb.month_end)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', mb.month_end)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(f.date_template,
    '@1@', strftime('%Y', mb.month_end)),
    '@2@', substr(strftime('%Y', mb.month_end), 3, 2)),
    '@3@', strftime('%d', mb.month_end)),
    '@4@', CAST(CAST(strftime('%d', mb.month_end) AS INTEGER) AS TEXT)),
    '@5@', strftime('%m', mb.month_end)),
    '@6@', CAST(CAST(strftime('%m', mb.month_end) AS INTEGER) AS TEXT)),
    '@7@', strftime('%H', mb.month_end)),
    '@8@', CAST(CAST(strftime('%H', mb.month_end) AS INTEGER) AS TEXT)),
    '@9@', printf('%02d', CASE CAST(strftime('%H', mb.month_end) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', mb.month_end) AS INTEGER) % 12 END)),
    '@10@', CAST(CASE CAST(strftime('%H', mb.month_end) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', mb.month_end) AS INTEGER) % 12 END AS TEXT)),
    '@11@', strftime('%M', mb.month_end)),
    '@12@', CAST(CAST(strftime('%M', mb.month_end) AS INTEGER) AS TEXT)),
    '@13@', CASE WHEN CAST(strftime('%H', mb.month_end) AS INTEGER) < 12 THEN 'AM' ELSE 'PM' END) AS "Month end",
  u.full_name AS "Employee",
  CASE
    WHEN f.locale LIKE 'de%' THEN CASE strftime('%w', ct.contract_start)
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', ct.contract_start)
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END || ', ' ||
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(f.date_template,
    '@1@', strftime('%Y', ct.contract_start)),
    '@2@', substr(strftime('%Y', ct.contract_start), 3, 2)),
    '@3@', strftime('%d', ct.contract_start)),
    '@4@', CAST(CAST(strftime('%d', ct.contract_start) AS INTEGER) AS TEXT)),
    '@5@', strftime('%m', ct.contract_start)),
    '@6@', CAST(CAST(strftime('%m', ct.contract_start) AS INTEGER) AS TEXT)),
    '@7@', strftime('%H', ct.contract_start)),
    '@8@', CAST(CAST(strftime('%H', ct.contract_start) AS INTEGER) AS TEXT)),
    '@9@', printf('%02d', CASE CAST(strftime('%H', ct.contract_start) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ct.contract_start) AS INTEGER) % 12 END)),
    '@10@', CAST(CASE CAST(strftime('%H', ct.contract_start) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ct.contract_start) AS INTEGER) % 12 END AS TEXT)),
    '@11@', strftime('%M', ct.contract_start)),
    '@12@', CAST(CAST(strftime('%M', ct.contract_start) AS INTEGER) AS TEXT)),
    '@13@', CASE WHEN CAST(strftime('%H', ct.contract_start) AS INTEGER) < 12 THEN 'AM' ELSE 'PM' END) AS "Contract start",
  CASE
    WHEN ct.contract_end IS NULL THEN CASE WHEN f.locale LIKE 'de%' THEN 'offen' ELSE 'open' END
    ELSE (
      CASE
        WHEN f.locale LIKE 'de%' THEN CASE strftime('%w', ct.contract_end)
          WHEN '0' THEN 'So.'
          WHEN '1' THEN 'Mo.'
          WHEN '2' THEN 'Di.'
          WHEN '3' THEN 'Mi.'
          WHEN '4' THEN 'Do.'
          WHEN '5' THEN 'Fr.'
          ELSE 'Sa.'
        END
        ELSE CASE strftime('%w', ct.contract_end)
          WHEN '0' THEN 'Sun.'
          WHEN '1' THEN 'Mon.'
          WHEN '2' THEN 'Tue.'
          WHEN '3' THEN 'Wed.'
          WHEN '4' THEN 'Thu.'
          WHEN '5' THEN 'Fri.'
          ELSE 'Sat.'
        END
      END || ', ' ||
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(f.date_template,
        '@1@', strftime('%Y', ct.contract_end)),
        '@2@', substr(strftime('%Y', ct.contract_end), 3, 2)),
        '@3@', strftime('%d', ct.contract_end)),
        '@4@', CAST(CAST(strftime('%d', ct.contract_end) AS INTEGER) AS TEXT)),
        '@5@', strftime('%m', ct.contract_end)),
        '@6@', CAST(CAST(strftime('%m', ct.contract_end) AS INTEGER) AS TEXT)),
        '@7@', strftime('%H', ct.contract_end)),
        '@8@', CAST(CAST(strftime('%H', ct.contract_end) AS INTEGER) AS TEXT)),
        '@9@', printf('%02d', CASE CAST(strftime('%H', ct.contract_end) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ct.contract_end) AS INTEGER) % 12 END)),
        '@10@', CAST(CASE CAST(strftime('%H', ct.contract_end) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ct.contract_end) AS INTEGER) % 12 END AS TEXT)),
        '@11@', strftime('%M', ct.contract_end)),
        '@12@', CAST(CAST(strftime('%M', ct.contract_end) AS INTEGER) AS TEXT)),
        '@13@', CASE WHEN CAST(strftime('%H', ct.contract_end) AS INTEGER) < 12 THEN 'AM' ELSE 'PM' END)
    )
  END AS "Contract end",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.hourly_rate, 0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' ' || f.currency AS "Hourly rate",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.weekly_hours, 0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "Weekly hours",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.target_hours, 0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "Monthly target",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.total_hours, 0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "Total worked",
  replace(replace(replace(printf('%,.2f',
    CASE
      WHEN ct.weekly_hours < 40 AND ct.total_hours > ct.target_hours
      THEN MIN(ct.total_hours - ct.target_hours, (40 * 4.33) - ct.target_hours)
      ELSE 0
    END
  ), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "25% overtime",
  replace(replace(replace(printf('%,.2f', MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "50% overtime",
  replace(replace(replace(printf('%,.2f', ct.holiday_hours), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' h' AS "100% Sunday and holiday",
  replace(replace(replace(printf('%,.2f', ct.total_hours * ct.hourly_rate), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' ' || f.currency AS "Base pay",
  replace(replace(replace(printf('%,.2f', MIN(MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0) * ct.hourly_rate * 0.5, 170.0)), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' ' || f.currency AS "Tax free max",
  replace(replace(replace(printf('%,.2f',
    (ct.total_hours * ct.hourly_rate) +
    (CASE
      WHEN ct.weekly_hours < 40 AND ct.total_hours > ct.target_hours
      THEN MIN(ct.total_hours - ct.target_hours, 173.2 - ct.target_hours) * ct.hourly_rate * 0.25
      ELSE 0
    END) +
    (MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0) * ct.hourly_rate * 0.5) +
    (ct.holiday_hours * ct.hourly_rate)
  ), ',', '__GROUP__'), '.', f.decimal_mark), '__GROUP__', f.group_mark) || ' ' || f.currency AS "Gross total"
FROM contract_totals ct
JOIN users u ON u.id = ct.user_id AND u.deleted_at IS NULL AND u.is_active = 1
CROSS JOIN month_bounds mb
CROSS JOIN format_ctx f
ORDER BY ct.total_hours * ct.hourly_rate DESC, u.full_name ASC
`.trim(),
};

export default preset;
