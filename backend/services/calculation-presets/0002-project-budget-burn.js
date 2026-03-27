export const preset = {
  key: "project_budget_burn",
  name: "Project budget burn",
  description: "Compare project budget against labor cost calculated from the latest contract rate for each user.",
  sqlText: `
WITH latest_contracts AS (
  SELECT uc.user_id, uc.payment_per_hour
  FROM user_contracts uc
  INNER JOIN (
    SELECT user_id, MAX(start_date) AS start_date
    FROM user_contracts
    GROUP BY user_id
  ) latest
    ON latest.user_id = uc.user_id
   AND latest.start_date = uc.start_date
),
project_costs AS (
  SELECT
    te.project_id,
    SUM(
      CASE
        WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
        THEN ((julianday(te.end_time) - julianday(te.start_time)) * 24.0) * COALESCE(lc.payment_per_hour, 0)
        ELSE 0
      END
    ) AS cost
  FROM time_entries te
  LEFT JOIN latest_contracts lc ON lc.user_id = te.user_id
  WHERE te.project_id IS NOT NULL
  GROUP BY te.project_id
)
SELECT
  p.name AS label,
  ROUND(p.budget, 2) AS budget,
  ROUND(COALESCE(pc.cost, 0), 2) AS cost,
  ROUND(ROUND(COALESCE(pc.cost, 0), 2) - ROUND(p.budget, 2), 2) AS variance
FROM projects p
LEFT JOIN project_costs pc ON pc.project_id = p.id
ORDER BY variance DESC, p.name ASC
  `.trim(),
  outputMode: "both",
  chartConfig: {
    type: "bar",
    categoryColumn: "label",
    valueColumn: "cost",
    seriesColumn: null,
    stacked: false,
  },
};

export default preset;
