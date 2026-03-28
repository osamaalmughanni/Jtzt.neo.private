import type { CompanySettings } from "../../shared/types/models";

function buildSettingsContextCte() {
  return `settings_ctx AS (
  SELECT
    COALESCE(NULLIF(locale, ''), 'de-AT') AS locale,
    COALESCE(NULLIF(date_time_format, ''), 'dd.MM.yyyy HH:mm') AS date_time_format,
    COALESCE(NULLIF(currency, ''), 'EUR') AS currency
  FROM company_settings
  LIMIT 1
)`;
}

function buildTemplateExpression() {
  return "(SELECT date_time_format FROM settings_ctx)";
}

function buildDateTokenTemplateExpression() {
  let expression = buildTemplateExpression();
  const replacements: Array<[string, string]> = [
    ["yyyy", "__YEAR4__"],
    ["yy", "__YEAR2__"],
    ["dd", "__DAY2__"],
    ["d", "__DAY1__"],
    ["MM", "__MONTH2__"],
    ["M", "__MONTH1__"],
    ["HH", "__HOUR24_2__"],
    ["H", "__HOUR24_1__"],
    ["hh", "__HOUR12_2__"],
    ["h", "__HOUR12_1__"],
    ["mm", "__MINUTE2__"],
    ["m", "__MINUTE1__"],
    ["ss", "__SECOND2__"],
    ["s", "__SECOND1__"],
    ["tt", "__AMPM__"],
  ];

  for (const [token, placeholder] of replacements) {
    expression = `replace(${expression}, '${token}', '${placeholder}')`;
  }

  return expression;
}

function buildDateFormatExpression(dateExpression: string) {
  let expression = buildDateTokenTemplateExpression();
  const replacements: Array<[string, string]> = [
    ["__YEAR4__", `strftime('%Y', ${dateExpression})`],
    ["__YEAR2__", `substr(strftime('%Y', ${dateExpression}), 3, 2)`],
    ["__DAY2__", `strftime('%d', ${dateExpression})`],
    ["__DAY1__", `CAST(strftime('%d', ${dateExpression}) AS INTEGER)`],
    ["__MONTH2__", `strftime('%m', ${dateExpression})`],
    ["__MONTH1__", `CAST(strftime('%m', ${dateExpression}) AS INTEGER)`],
    ["__HOUR24_2__", `strftime('%H', ${dateExpression})`],
    ["__HOUR24_1__", `CAST(strftime('%H', ${dateExpression}) AS INTEGER)`],
    ["__HOUR12_2__", `printf('%02d', CASE CAST(strftime('%H', ${dateExpression}) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ${dateExpression}) AS INTEGER) % 12 END)`],
    ["__HOUR12_1__", `CASE CAST(strftime('%H', ${dateExpression}) AS INTEGER) % 12 WHEN 0 THEN 12 ELSE CAST(strftime('%H', ${dateExpression}) AS INTEGER) % 12 END`],
    ["__MINUTE2__", `strftime('%M', ${dateExpression})`],
    ["__MINUTE1__", `CAST(strftime('%M', ${dateExpression}) AS INTEGER)`],
    ["__SECOND2__", `strftime('%S', ${dateExpression})`],
    ["__SECOND1__", `CAST(strftime('%S', ${dateExpression}) AS INTEGER)`],
    ["__AMPM__", `CASE WHEN CAST(strftime('%H', ${dateExpression}) AS INTEGER) < 12 THEN 'AM' ELSE 'PM' END`],
  ];

  for (const [placeholder, replacement] of replacements) {
    expression = `replace(${expression}, '${placeholder}', CAST(${replacement} AS TEXT))`;
  }

  return expression;
}

function buildDecimalMarkExpression() {
  return `CASE
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de%' OR
         (SELECT locale FROM settings_ctx) LIKE 'fr%' OR
         (SELECT locale FROM settings_ctx) LIKE 'it%' OR
         (SELECT locale FROM settings_ctx) LIKE 'es%' OR
         (SELECT locale FROM settings_ctx) LIKE 'nl%' OR
         (SELECT locale FROM settings_ctx) LIKE 'pt%'
      THEN ','
    ELSE '.'
  END`;
}

function buildGroupMarkExpression() {
  return `CASE
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de-CH%' OR (SELECT locale FROM settings_ctx) LIKE 'fr-CH%' THEN ''''
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de%' OR
         (SELECT locale FROM settings_ctx) LIKE 'fr%' OR
         (SELECT locale FROM settings_ctx) LIKE 'it%' OR
         (SELECT locale FROM settings_ctx) LIKE 'es%' OR
         (SELECT locale FROM settings_ctx) LIKE 'nl%' OR
         (SELECT locale FROM settings_ctx) LIKE 'pt%'
      THEN '.'
    ELSE ','
  END`;
}

function buildLocalizedNumberExpression(valueExpression: string, suffixExpression?: string) {
  const base = `replace(replace(replace(printf('%,.2f', ${valueExpression}), ',', '__GROUP__'), '.', ${buildDecimalMarkExpression()}), '__GROUP__', ${buildGroupMarkExpression()})`;
  return suffixExpression ? `(${base} || ${suffixExpression})` : base;
}

function buildWeekdayShortExpression(dateExpression: string) {
  return `CASE
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de%' THEN CASE strftime('%w', ${dateExpression})
      WHEN '0' THEN 'So.'
      WHEN '1' THEN 'Mo.'
      WHEN '2' THEN 'Di.'
      WHEN '3' THEN 'Mi.'
      WHEN '4' THEN 'Do.'
      WHEN '5' THEN 'Fr.'
      ELSE 'Sa.'
    END
    ELSE CASE strftime('%w', ${dateExpression})
      WHEN '0' THEN 'Sun.'
      WHEN '1' THEN 'Mon.'
      WHEN '2' THEN 'Tue.'
      WHEN '3' THEN 'Wed.'
      WHEN '4' THEN 'Thu.'
      WHEN '5' THEN 'Fri.'
      ELSE 'Sat.'
    END
  END`;
}

function buildMonthShortExpression(dateExpression: string) {
  return `CASE
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de%' THEN CASE strftime('%m', ${dateExpression})
      WHEN '01' THEN 'Jän.'
      WHEN '02' THEN 'Feb.'
      WHEN '03' THEN 'Mär.'
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
    ELSE CASE strftime('%m', ${dateExpression})
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
  END`;
}

function buildOpenEndedLabelExpression() {
  return `CASE
    WHEN (SELECT locale FROM settings_ctx) LIKE 'de%' THEN 'offen'
    ELSE 'open'
  END`;
}

export function buildMonthlyOvertimeSql(_settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const money = (expression: string) => buildLocalizedNumberExpression(expression, `(' ' || COALESCE((SELECT currency FROM settings_ctx), 'EUR'))`);
  const hours = (expression: string) => buildLocalizedNumberExpression(expression, `' h'`);

  return `
WITH RECURSIVE
${buildSettingsContextCte()},
month_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of month') AS month_start,
    date(datetime('now', 'localtime'), 'start of month', '+1 month') AS month_end_exclusive,
    date(datetime('now', 'localtime'), 'start of month', '+1 month', '-1 day') AS month_end
),
active_contracts AS (
  SELECT * FROM (
    SELECT
      uc.*,
      ROW_NUMBER() OVER (PARTITION BY uc.user_id ORDER BY uc.start_date DESC, uc.id DESC) AS rn
    FROM user_contracts uc
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
  ${buildWeekdayShortExpression("mb.month_start")} || ', ' || ${buildDateFormatExpression("mb.month_start")} AS "Month start",
  ${buildWeekdayShortExpression("mb.month_end")} || ', ' || ${buildDateFormatExpression("mb.month_end")} AS "Month end",
  u.full_name AS "Employee",
  ${buildWeekdayShortExpression("ct.contract_start")} || ', ' || ${buildDateFormatExpression("ct.contract_start")} AS "Contract start",
  CASE
    WHEN ct.contract_end IS NULL THEN ${buildOpenEndedLabelExpression()}
    ELSE ${buildWeekdayShortExpression("ct.contract_end")} || ', ' || ${buildDateFormatExpression("ct.contract_end")}
  END AS "Contract end",
  ${money("COALESCE(ct.hourly_rate, 0)")} AS "Hourly rate",
  ${hours("COALESCE(ct.weekly_hours, 0)")} AS "Weekly hours",
  ${hours("COALESCE(ct.target_hours, 0)")} AS "Monthly target",
  ${hours("COALESCE(ct.total_hours, 0)")} AS "Total worked",
  ${hours(`CASE
    WHEN ct.weekly_hours < 40 AND ct.total_hours > ct.target_hours
      THEN MIN(ct.total_hours - ct.target_hours, (40 * 4.33) - ct.target_hours)
    ELSE 0
  END`)} AS "25% overtime",
  ${hours("MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0)")} AS "50% overtime",
  ${hours("ct.holiday_hours")} AS "100% Sunday and holiday",
  ${money("ct.total_hours * ct.hourly_rate")} AS "Base pay",
  ${money("MIN(MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0) * ct.hourly_rate * 0.5, 170.0)")} AS "Tax free max",
  ${money(`(ct.total_hours * ct.hourly_rate) +
    (CASE
      WHEN ct.weekly_hours < 40 AND ct.total_hours > ct.target_hours
        THEN MIN(ct.total_hours - ct.target_hours, 173.2 - ct.target_hours) * ct.hourly_rate * 0.25
      ELSE 0
    END) +
    (MAX(ct.weekday_hours - MAX(ct.target_hours, 173.2), 0) * ct.hourly_rate * 0.5) +
    (ct.holiday_hours * ct.hourly_rate)`)} AS "Gross total"
FROM contract_totals ct
JOIN users u ON u.id = ct.user_id
CROSS JOIN month_bounds mb
ORDER BY ct.total_hours * ct.hourly_rate DESC, u.full_name ASC
`.trim();
}

export function buildYearlyVacationSql(_settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  return `
WITH RECURSIVE
${buildSettingsContextCte()},
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
  LEFT JOIN company_settings cs ON 1=1
  WHERE vd.day BETWEEN y.year_start AND y.year_end
    AND h.date IS NULL
    AND instr(',' || COALESCE(REPLACE(cs.weekend_days_json, ' ', ''), '[6,7]') || ',', ',' ||
      CASE strftime('%w', vd.day) WHEN '0' THEN '7' ELSE strftime('%w', vd.day) END || ',') = 0
  GROUP BY vd.user_id
)
SELECT
  strftime('%Y', y.year_start) AS "Year",
  ${buildWeekdayShortExpression("y.year_start")} || ', ' || ${buildDateFormatExpression("y.year_start")} AS "Year start",
  ${buildWeekdayShortExpression("y.year_end")} || ', ' || ${buildDateFormatExpression("y.year_end")} AS "Year end",
  u.full_name AS "Employee",
  CAST(ROUND(COALESCE(ent.entitled_days, 0), 0) AS INTEGER) AS "Vacation entitlement",
  CAST(ROUND(COALESCE(used.taken_days, 0), 0) AS INTEGER) AS "Vacation taken",
  CAST(ROUND(MAX(COALESCE(ent.entitled_days, 0) - COALESCE(used.taken_days, 0), 0), 0) AS INTEGER) AS "Vacation available",
  CAST(ROUND(COALESCE(ent.entitled_days, 0) - COALESCE(used.taken_days, 0), 0) AS INTEGER) AS "Remaining vacation"
FROM users u
CROSS JOIN year_bounds y
LEFT JOIN yearly_entitlement ent ON ent.user_id = u.id
LEFT JOIN yearly_used used ON used.user_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY "Vacation available" DESC, u.full_name ASC
`.trim();
}

export function buildYearlyOvertimeLedgerSql(_settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  return `
WITH RECURSIVE
${buildSettingsContextCte()},
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
  ${buildMonthShortExpression("ms.month_start")} || ' ' || strftime('%Y', ms.month_start) AS "Month",
  ms.full_name AS "Employee",
  ${buildWeekdayShortExpression("ms.month_first_day")} || ', ' || ${buildDateFormatExpression("ms.month_first_day")} AS "Month start",
  ${buildWeekdayShortExpression("ms.month_last_day")} || ', ' || ${buildDateFormatExpression("ms.month_last_day")} AS "Month end",
  CAST(ROUND(COALESCE(ms.planned_work_days, 0), 0) AS INTEGER) AS "Planned days",
  CAST(ROUND(COALESCE(ms.actual_work_days, 0), 0) AS INTEGER) AS "Worked days",
  CAST(ROUND(COALESCE(ms.holiday_days, 0), 0) AS INTEGER) AS "Holidays",
  CAST(ROUND(COALESCE(ms.work_entries, 0), 0) AS INTEGER) AS "Work entries",
  printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) % 60) AS "Scheduled hours",
  printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) % 60) AS "Worked hours",
  CASE WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE '' END ||
    printf('%d:%02d h', ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60, ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60) AS "Monthly balance"
FROM month_summary ms
ORDER BY ms.month_start DESC, ms.full_name ASC
`.trim();
}
