export const preset = {
  key: "user_workload_last_30_days",
  name: "User workload last 30 days",
  description: "Show total worked hours per active user for the last 30 days.",
  sqlText: `
SELECT
  u.full_name AS label,
  ROUND(
    SUM(
      CASE
        WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
        THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0
        ELSE 0
      END
    ),
    2
  ) AS hours
FROM users u
LEFT JOIN time_entries te
  ON te.user_id = u.id
 AND te.entry_date >= date('now', '-30 day')
WHERE u.deleted_at IS NULL
GROUP BY u.id
ORDER BY hours DESC, u.full_name ASC
  `.trim(),
  outputMode: "both",
  chartConfig: {
    type: "line",
    categoryColumn: "label",
    valueColumn: "hours",
    seriesColumn: null,
    stacked: false,
  },
};

export default preset;
