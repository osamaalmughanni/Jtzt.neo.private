import type { CompanySettings } from "../../shared/types/models";

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function getLocaleNumberSymbols(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

function getWeekdayLabels(locale: string) {
  const base = new Date(Date.UTC(2026, 2, 1));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + index);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  });
}

function getMonthLabels(locale: string) {
  return Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(Date.UTC(2026, index, 1))));
}

function toSqliteStrftimePattern(pattern: string) {
  return pattern
    .replaceAll("yyyy", "%Y")
    .replaceAll("yy", "%y")
    .replaceAll("MM", "%m")
    .replaceAll("dd", "%d")
    .replaceAll("HH", "%H")
    .replaceAll("hh", "%I")
    .replaceAll("mm", "%M")
    .replaceAll("ss", "%S")
    .replaceAll("M", "%m")
    .replaceAll("d", "%d")
    .replaceAll("H", "%H")
    .replaceAll("h", "%I")
    .replaceAll("m", "%M")
    .replaceAll("s", "%S");
}

function buildSqliteDateExpression(expression: string, pattern: string) {
  return `strftime('${escapeSqlLiteral(toSqliteStrftimePattern(pattern))}', ${expression})`;
}

function buildLocalizedNumberExpression(expression: string, locale: string, suffix?: string) {
  const symbols = getLocaleNumberSymbols(locale);
  const base = `replace(replace(replace(printf('%,.2f', ${expression}), ',', 'X'), '.', '${escapeSqlLiteral(symbols.decimal)}'), 'X', '${escapeSqlLiteral(symbols.group)}')`;
  return suffix ? `${base} || '${escapeSqlLiteral(suffix)}'` : base;
}

function buildWeekdayCase(expression: string, locale: string) {
  const labels = getWeekdayLabels(locale);
  return `CASE strftime('%w', ${expression})
    WHEN '0' THEN '${escapeSqlLiteral(labels[0])}'
    WHEN '1' THEN '${escapeSqlLiteral(labels[1])}'
    WHEN '2' THEN '${escapeSqlLiteral(labels[2])}'
    WHEN '3' THEN '${escapeSqlLiteral(labels[3])}'
    WHEN '4' THEN '${escapeSqlLiteral(labels[4])}'
    WHEN '5' THEN '${escapeSqlLiteral(labels[5])}'
    ELSE '${escapeSqlLiteral(labels[6])}'
  END`;
}

function buildMonthCase(expression: string, locale: string) {
  const labels = getMonthLabels(locale);
  return `CASE strftime('%m', ${expression})
    WHEN '01' THEN '${escapeSqlLiteral(labels[0])}'
    WHEN '02' THEN '${escapeSqlLiteral(labels[1])}'
    WHEN '03' THEN '${escapeSqlLiteral(labels[2])}'
    WHEN '04' THEN '${escapeSqlLiteral(labels[3])}'
    WHEN '05' THEN '${escapeSqlLiteral(labels[4])}'
    WHEN '06' THEN '${escapeSqlLiteral(labels[5])}'
    WHEN '07' THEN '${escapeSqlLiteral(labels[6])}'
    WHEN '08' THEN '${escapeSqlLiteral(labels[7])}'
    WHEN '09' THEN '${escapeSqlLiteral(labels[8])}'
    WHEN '10' THEN '${escapeSqlLiteral(labels[9])}'
    WHEN '11' THEN '${escapeSqlLiteral(labels[10])}'
    ELSE '${escapeSqlLiteral(labels[11])}'
  END`;
}

export function getCalculationPresetLocaleContext(settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const locale = settings.locale?.trim() || "de-AT";
  const dateTimeFormat = settings.dateTimeFormat?.trim() || "dd.MM.yyyy HH:mm";
  const currency = settings.currency?.trim() || "EUR";
  const timeZone = settings.timeZone?.trim() || "Europe/Vienna";
  return { locale, dateTimeFormat, currency, timeZone };
}

export function buildMonthlyOvertimeSql(settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const { locale, dateTimeFormat, currency } = getCalculationPresetLocaleContext(settings);
  const weekdayLabel = buildWeekdayCase("mb.month_start", locale);
  const dateLabel = buildSqliteDateExpression("mb.month_start", dateTimeFormat);
  const endDateLabel = buildSqliteDateExpression("mb.month_end", dateTimeFormat);
  const contractStartLabel = buildSqliteDateExpression("ct.vertragsbeginn", dateTimeFormat);
  const contractEndLabel = buildSqliteDateExpression("ct.vertragsende", dateTimeFormat);
  const monthNameLabel = buildMonthCase("ms.month_start", locale);
  const number = (expression: string, suffix?: string) => buildLocalizedNumberExpression(expression, locale, suffix);

  return `
WITH RECURSIVE
month_bounds AS (
  SELECT
    date(datetime('now', 'localtime'), 'start of month') AS month_start,
    date(datetime('now', 'localtime'), 'start of month', '+1 month') AS next_month,
    date(datetime('now', 'localtime'), 'start of month', '+1 month', '-1 day') AS month_end
),
month_days(day) AS (
  SELECT month_start FROM month_bounds
  UNION ALL
  SELECT date(day, '+1 day')
  FROM month_days
  WHERE day < (SELECT month_end FROM month_bounds)
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
  ) WHERE rn = 1
),
daily_metrics AS (
  SELECT
    ac.user_id,
    te.entry_date,
    SUM(CASE WHEN te.entry_type = 'work' THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 ELSE 0 END) AS ist_std,
    strftime('%w', te.entry_date) AS weekday,
    (SELECT COUNT(*) FROM holidays h WHERE h.date = te.entry_date) AS is_holiday
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
    ac.start_date AS vertragsbeginn,
    ac.end_date AS vertragsende,
    ac.payment_per_hour AS satz,
    ac.hours_per_week AS vertrag_woche,
    (ac.hours_per_week * 4.33) AS soll_monat,
    COALESCE(SUM(dm.ist_std), 0) AS ist_monat,
    COALESCE(SUM(CASE WHEN dm.weekday = '0' OR dm.is_holiday > 0 THEN dm.ist_std ELSE 0 END), 0) AS std_100,
    COALESCE(SUM(CASE WHEN dm.weekday != '0' AND dm.is_holiday = 0 THEN dm.ist_std ELSE 0 END), 0) AS std_werktag
  FROM active_contracts ac
  LEFT JOIN daily_metrics dm ON dm.user_id = ac.user_id
  GROUP BY ac.id, ac.user_id, ac.start_date, ac.end_date, ac.payment_per_hour, ac.hours_per_week
)
SELECT
  ${weekdayLabel} || ', ' || ${dateLabel} AS "Month start",
  ${weekdayLabel.replaceAll("mb.month_start", "mb.month_end")} || ', ' || ${endDateLabel} AS "Month end",
  u.full_name AS "Employee",
  ${buildWeekdayCase("ct.vertragsbeginn", locale)} || ', ' || ${contractStartLabel} AS "Contract start",
  CASE
    WHEN ct.vertragsende IS NOT NULL THEN
      ${buildWeekdayCase("ct.vertragsende", locale)} || ', ' || ${contractEndLabel}
    ELSE '${locale.startsWith("de") ? "offen" : "open"}'
  END AS "Contract end",
  ${number("COALESCE(ct.satz, 0)", ` ${currency}`)} AS "Hourly rate",
  ${number("COALESCE(ct.vertrag_woche, 0)", " h")} AS "Weekly hours",
  ${number("COALESCE(ct.soll_monat, 0)", " h")} AS "Monthly target",
  ${number("COALESCE(ct.ist_monat, 0)", " h")} AS "Total worked",
  ${number(`CASE
      WHEN ct.vertrag_woche < 40 AND ct.ist_monat > ct.soll_monat
      THEN MIN(ct.ist_monat - ct.soll_monat, (40 * 4.33) - ct.soll_monat)
      ELSE 0
    END`, " h")} AS "25% overtime",
  ${number("MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0)", " h")} AS "50% overtime",
  ${number("ct.std_100", " h")} AS "100% Sunday and holiday",
  ${number("ct.ist_monat * ct.satz", ` ${currency}`)} AS "Base pay",
  ${number("MIN(MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0) * ct.satz * 0.5, 170.0)", ` ${currency}`)} AS "Tax free max",
  ${number(`(ct.ist_monat * ct.satz) +
    (CASE WHEN ct.vertrag_woche < 40 AND ct.ist_monat > ct.soll_monat THEN MIN(ct.ist_monat - ct.soll_monat, 173.2 - ct.soll_monat) ELSE 0 END * ct.satz * 0.25) +
    (MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0) * ct.satz * 0.5) +
    (ct.std_100 * ct.satz * 1.0)`, ` ${currency}`)} AS "Gross total"
FROM contract_totals ct
JOIN users u ON u.id = ct.user_id
CROSS JOIN month_bounds mb
ORDER BY "Gross total" DESC
`.trim();
}

export function buildYearlyVacationSql(settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const { locale, dateTimeFormat } = getCalculationPresetLocaleContext(settings);
  const weekday = (expr: string) => buildWeekdayCase(expr, locale);
  const date = (expr: string) => buildSqliteDateExpression(expr, dateTimeFormat);
  return `
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
  strftime('%Y', y.year_start) AS "Year",
  ${weekday("y.year_start")} || ', ' || ${date("y.year_start")} AS "Year start",
  ${weekday("y.year_end")} || ', ' || ${date("y.year_end")} AS "Year end",
  u.full_name AS "Employee",
  CAST(ROUND(COALESCE(ent.soll_urlaub, 0), 0) AS INTEGER) || '' AS "Vacation entitlement",
  CAST(ROUND(COALESCE(used.ist_urlaub, 0), 0) AS INTEGER) || '' AS "Vacation taken",
  CAST(ROUND(MAX(COALESCE(ent.soll_urlaub, 0) - COALESCE(used.ist_urlaub, 0), 0), 0) AS INTEGER) || '' AS "Vacation available",
  CAST(ROUND(COALESCE(ent.soll_urlaub, 0) - COALESCE(used.ist_urlaub, 0), 0) AS INTEGER) || '' AS "Remaining vacation"
FROM users u
CROSS JOIN year_bounds y
LEFT JOIN yearly_entitlement ent ON ent.user_id = u.id
LEFT JOIN yearly_used used ON used.user_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY "Vacation available" DESC, u.full_name ASC
`.trim();
}

export function buildYearlyOvertimeLedgerSql(settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const { locale, dateTimeFormat } = getCalculationPresetLocaleContext(settings);
  const weekday = (expr: string) => buildWeekdayCase(expr, locale);
  const date = (expr: string) => buildSqliteDateExpression(expr, dateTimeFormat);
  const month = (expr: string) => buildMonthCase(expr, locale);
  const number = (expression: string, suffix?: string) => buildLocalizedNumberExpression(expression, locale, suffix);
  return `
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
    strftime('%Y', ms.month_start) AS "Year",
    ${month("ms.month_start")} || ' ' || strftime('%Y', ms.month_start) AS "Month",
    ms.full_name AS "Employee",
    ${weekday("ms.month_first_day")} || ', ' || ${date("ms.month_first_day")} AS "Month start",
    ${weekday("ms.month_last_day")} || ', ' || ${date("ms.month_last_day")} AS "Month end",
    CAST(ROUND(COALESCE(ms.contract_count, 0), 0) AS INTEGER) || '' AS "Contracts",
    CAST(ROUND(COALESCE(ms.planned_work_days, 0), 0) AS INTEGER) || '' AS "Planned days",
    CAST(ROUND(COALESCE(ms.actual_work_days, 0), 0) AS INTEGER) || '' AS "Worked days",
    CAST(ROUND(COALESCE(ms.holiday_days, 0), 0) AS INTEGER) || '' AS "Holidays",
    CAST(ROUND(COALESCE(ms.work_entries, 0), 0) AS INTEGER) || '' AS "Work entries",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.planned_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Scheduled hours",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.worked_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Worked hours",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN '-' ELSE ''
    END || printf(
      '%d:%02d h',
      ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60,
      ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60
    ) AS "Monthly balance",
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
    ) AS "Cumulative balance",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) > 0 THEN
        '+' || printf(
          '%d:%02d h',
          CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) / 60,
          CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) % 60
        )
      ELSE '0:00 h'
    END AS "Positive hours",
    CASE
      WHEN CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER) < 0 THEN
        '-' || printf(
          '%d:%02d h',
          ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) / 60,
          ABS(CAST(ROUND(COALESCE(ms.balance_minutes, 0), 0) AS INTEGER)) % 60
        )
      ELSE '0:00 h'
    END AS "Negative hours"
  FROM month_summary ms
)
SELECT * FROM monthly_rows
ORDER BY "Cumulative balance" DESC, "Employee" ASC
`.trim();
}
