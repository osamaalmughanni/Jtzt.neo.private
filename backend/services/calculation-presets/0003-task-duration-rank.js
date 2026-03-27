export const preset = {
  key: "task_duration_rank",
  name: "Task duration ranking",
  description: "Rank tasks by total worked minutes in the selected company database.",
  sqlText: `
SELECT
  t.title AS label,
  ROUND(
    SUM(
      CASE
        WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
        THEN (julianday(te.end_time) - julianday(te.start_time)) * 24.0 * 60.0
        ELSE 0
      END
    ),
    0
  ) AS minutes
FROM tasks t
LEFT JOIN time_entries te ON te.task_id = t.id
GROUP BY t.id
ORDER BY minutes DESC, t.title ASC
  `.trim(),
  outputMode: "chart",
  chartConfig: {
    type: "bar",
    categoryColumn: "label",
    valueColumn: "minutes",
    seriesColumn: null,
    stacked: false,
  },
};

export default preset;
