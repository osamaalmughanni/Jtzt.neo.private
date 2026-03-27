export const preset = {
  key: "austrian_monthly_overtime_by_worker",
  name: "Austrian monthly overtime by worker",
  description: "Show monthly overtime, contract hours, and payroll impact per worker using Austrian 25%, 50%, and 100% surcharge logic.",
  sqlText: `
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
  CASE strftime('%w', mb.month_start)
    WHEN '0' THEN 'So'
    WHEN '1' THEN 'Mo'
    WHEN '2' THEN 'Di'
    WHEN '3' THEN 'Mi'
    WHEN '4' THEN 'Do'
    WHEN '5' THEN 'Fr'
    ELSE 'Sa'
  END || ', ' || strftime('%d.%m.%Y', mb.month_start) AS "Monatsbeginn",
  CASE strftime('%w', mb.month_end)
    WHEN '0' THEN 'So'
    WHEN '1' THEN 'Mo'
    WHEN '2' THEN 'Di'
    WHEN '3' THEN 'Mi'
    WHEN '4' THEN 'Do'
    WHEN '5' THEN 'Fr'
    ELSE 'Sa'
  END || ', ' || strftime('%d.%m.%Y', mb.month_end) AS "Monatsende",
  u.full_name AS "Mitarbeiter",
  CASE strftime('%w', ct.vertragsbeginn)
    WHEN '0' THEN 'So'
    WHEN '1' THEN 'Mo'
    WHEN '2' THEN 'Di'
    WHEN '3' THEN 'Mi'
    WHEN '4' THEN 'Do'
    WHEN '5' THEN 'Fr'
    ELSE 'Sa'
  END || ', ' || strftime('%d.%m.%Y', ct.vertragsbeginn) AS "Vertragsbeginn",
  CASE
    WHEN ct.vertragsende IS NOT NULL THEN
      CASE strftime('%w', ct.vertragsende)
        WHEN '0' THEN 'So'
        WHEN '1' THEN 'Mo'
        WHEN '2' THEN 'Di'
        WHEN '3' THEN 'Mi'
        WHEN '4' THEN 'Do'
        WHEN '5' THEN 'Fr'
        ELSE 'Sa'
      END || ', ' || strftime('%d.%m.%Y', ct.vertragsende)
    ELSE 'offen'
  END AS "Vertragsende",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.satz, 0)), ',', 'X'), '.', ','), 'X', '.') || ' EUR' AS "Stundensatz",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.vertrag_woche, 0)), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Wochenstunden",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.soll_monat, 0)), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Sollstunden im Monat",
  replace(replace(replace(printf('%,.2f', COALESCE(ct.ist_monat, 0)), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Iststunden gesamt",
  replace(replace(replace(printf('%,.2f',
    CASE
      WHEN ct.vertrag_woche < 40 AND ct.ist_monat > ct.soll_monat
      THEN MIN(ct.ist_monat - ct.soll_monat, (40 * 4.33) - ct.soll_monat)
      ELSE 0
    END
  ), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Mehrarbeit 25%",
  replace(replace(replace(printf('%,.2f', MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0)), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Überstunden 50%",
  replace(replace(replace(printf('%,.2f', ct.std_100), ',', 'X'), '.', ','), 'X', '.') || ' h' AS "Sonn- und Feiertag 100%",
  replace(replace(replace(printf('%,.2f', ct.ist_monat * ct.satz), ',', 'X'), '.', ','), 'X', '.') || ' EUR' AS "Grundverdienst",
  replace(replace(replace(printf('%,.2f', MIN(MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0) * ct.satz * 0.5, 170.0)), ',', 'X'), '.', ','), 'X', '.') || ' EUR' AS "Steuerfrei §68(2) max. 170",
  replace(replace(replace(printf('%,.2f',
    (ct.ist_monat * ct.satz) +
    (CASE WHEN ct.vertrag_woche < 40 AND ct.ist_monat > ct.soll_monat THEN MIN(ct.ist_monat - ct.soll_monat, 173.2 - ct.soll_monat) ELSE 0 END * ct.satz * 0.25) +
    (MAX(ct.std_werktag - MAX(ct.soll_monat, 173.2), 0) * ct.satz * 0.5) +
    (ct.std_100 * ct.satz * 1.0)
  ), ',', 'X'), '.', ','), 'X', '.') || ' EUR' AS "Gesamtkosten brutto"
FROM contract_totals ct
JOIN users u ON u.id = ct.user_id
CROSS JOIN month_bounds mb
ORDER BY "Gesamtkosten brutto" DESC
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
