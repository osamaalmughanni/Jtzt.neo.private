import { HTTPException } from "hono/http-exception";
import type {
  CalculationPresetRecord,
  CalculationRecord,
  CalculationOutputMode,
  CalculationChartType,
  CalculationChartConfig,
} from "../../shared/types/models";
import type {
  CalculationValidationIssue,
  CreateCalculationFromPresetInput,
  CreateCalculationInput,
  UpdateCalculationInput,
} from "../../shared/types/api";
import { mapCalculation } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

type PreviewRow = Record<string, string | number | null>;

const BUILTIN_PRESETS: CalculationPresetRecord[] = [
  {
    key: "austrian_monthly_overtime_by_worker",
    name: "Austrian monthly overtime by worker",
    description: "Show the current month overtime, contract hours, and payroll impact per worker using the Austrian 50% overtime surcharge rule.",
    sqlText: `
WITH RECURSIVE
month_bounds AS (
  SELECT
    date('now', 'start of month') AS month_start,
    date('now', 'start of month', '+1 month') AS next_month,
    date('now', 'start of month', '+1 month', '-1 day') AS month_end
),
month_days(day) AS (
  SELECT month_start FROM month_bounds
  UNION ALL
  SELECT date(day, '+1 day')
  FROM month_days
  WHERE day < (SELECT month_end FROM month_bounds)
),
active_contracts AS (
  SELECT *
  FROM (
    SELECT
      uc.*,
      ROW_NUMBER() OVER (
        PARTITION BY uc.user_id
        ORDER BY uc.start_date DESC, uc.id DESC
      ) AS rn
    FROM user_contracts uc
    CROSS JOIN month_bounds mb
    WHERE uc.start_date <= mb.month_end
      AND (uc.end_date IS NULL OR uc.end_date >= mb.month_start)
  )
  WHERE rn = 1
),
contract_expected AS (
  SELECT
    ac.id AS contract_id,
    ac.user_id,
    SUM(COALESCE(sb.minutes, 0)) AS expected_minutes
  FROM active_contracts ac
  CROSS JOIN month_bounds mb
  JOIN month_days md
    ON md.day >= ac.start_date
   AND (ac.end_date IS NULL OR md.day <= ac.end_date)
  LEFT JOIN user_contract_schedule_blocks sb
    ON sb.contract_id = ac.id
   AND sb.weekday = ((CAST(strftime('%w', md.day) AS INTEGER) + 6) % 7) + 1
  GROUP BY ac.id, ac.user_id
),
contract_work AS (
  SELECT
    ac.id AS contract_id,
    ac.user_id,
    SUM(
      CASE
        WHEN te.entry_type = 'work' AND te.start_time IS NOT NULL AND te.end_time IS NOT NULL
        THEN ROUND((julianday(te.end_time) - julianday(te.start_time)) * 24.0 * 60.0, 0)
        ELSE 0
      END
    ) AS worked_minutes
  FROM active_contracts ac
  CROSS JOIN month_bounds mb
  LEFT JOIN time_entries te
    ON te.user_id = ac.user_id
   AND te.entry_date >= mb.month_start
   AND te.entry_date < mb.next_month
  GROUP BY ac.id, ac.user_id
)
SELECT
  u.full_name AS worker,
  mb.month_start AS month_start,
  mb.month_end AS month_end,
  ac.start_date AS contract_start,
  ac.end_date AS contract_end,
  ROUND(ac.hours_per_week, 2) AS contract_week_hours,
  ROUND(ac.payment_per_hour, 2) AS payment_per_hour,
  ROUND(COALESCE(ce.expected_minutes, 0) / 60.0, 2) AS expected_hours,
  COALESCE(ce.expected_minutes, 0) AS expected_minutes,
  ROUND(COALESCE(cw.worked_minutes, 0) / 60.0, 2) AS worked_hours,
  COALESCE(cw.worked_minutes, 0) AS worked_minutes,
  ROUND(MAX(COALESCE(cw.worked_minutes, 0) - COALESCE(ce.expected_minutes, 0), 0) / 60.0, 2) AS overtime_hours,
  MAX(COALESCE(cw.worked_minutes, 0) - COALESCE(ce.expected_minutes, 0), 0) AS overtime_minutes,
  50 AS overtime_rate_percent,
  ROUND(MAX(COALESCE(cw.worked_minutes, 0) - COALESCE(ce.expected_minutes, 0), 0) / 60.0 * ac.payment_per_hour, 2) AS overtime_base_cost,
  ROUND(MAX(COALESCE(cw.worked_minutes, 0) - COALESCE(ce.expected_minutes, 0), 0) / 60.0 * ac.payment_per_hour * 0.5, 2) AS overtime_surcharge_cost,
  ROUND(MAX(COALESCE(cw.worked_minutes, 0) - COALESCE(ce.expected_minutes, 0), 0) / 60.0 * ac.payment_per_hour * 1.5, 2) AS overtime_total_cost
FROM active_contracts ac
JOIN users u ON u.id = ac.user_id
CROSS JOIN month_bounds mb
LEFT JOIN contract_expected ce ON ce.contract_id = ac.id
LEFT JOIN contract_work cw ON cw.contract_id = ac.id
WHERE u.deleted_at IS NULL
ORDER BY overtime_minutes DESC, worker ASC
    `.trim(),
    outputMode: "table",
    chartConfig: {
      type: "bar",
      categoryColumn: "worker",
      valueColumn: "overtime_minutes",
      seriesColumn: null,
      stacked: false,
    },
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

function normalizeSql(sqlText: string) {
  return sqlText.trim().replace(/;+\s*$/, "");
}

function isReadOnlySql(sqlText: string) {
  const normalized = sqlText.trim();
  return /^(with|select)\b/i.test(normalized);
}

function validateReadOnlySql(sqlText: string) {
  const issues: CalculationValidationIssue[] = [];
  const normalized = sqlText.trim().replace(/;+\s*$/, "");
  if (!normalized) {
    issues.push({ level: "error", message: "SQL is required" });
    return issues;
  }

  if (!isReadOnlySql(normalized)) {
    issues.push({ level: "error", message: "Only SELECT or WITH queries are allowed" });
  }

  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma)\b/i.test(normalized)) {
    issues.push({ level: "error", message: "Write operations are not allowed" });
  }

  if (normalized.includes(";")) {
    issues.push({ level: "error", message: "Semicolons are not allowed" });
  }

  return issues;
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeChartConfig(config: CalculationChartConfig): CalculationChartConfig {
  return {
    type: config.type,
    categoryColumn: normalizeText(config.categoryColumn),
    valueColumn: normalizeText(config.valueColumn),
    seriesColumn: normalizeText(config.seriesColumn),
    stacked: Boolean(config.stacked),
  };
}

function getPresetRecord(key: string) {
  return BUILTIN_PRESETS.find((preset) => preset.key === key) ?? null;
}

async function previewSql(db: AppDatabase, sqlText: string, limit = 50) {
  const previewSqlText = `SELECT * FROM (${normalizeSql(sqlText)}) AS calculation_preview LIMIT ${limit}`;
  return await db.all<PreviewRow>(previewSqlText);
}

function collectColumns(rows: PreviewRow[]) {
  return rows.length > 0 ? Object.keys(rows[0]) : [];
}

function normalizeCalculationRow(row: any): CalculationRecord {
  return mapCalculation(row);
}

export const calculationService = {
  listPresets(): CalculationPresetRecord[] {
    return BUILTIN_PRESETS;
  },

  async listCalculations(db: AppDatabase, companyId: string) {
    const calculations = (await db.all(
      `SELECT
         id,
         company_id,
         name,
         description,
         sql_text,
         output_mode,
         chart_type,
         chart_category_column,
         chart_value_column,
         chart_series_column,
         chart_config_json,
         chart_stacked,
         is_builtin,
         created_at,
         updated_at
       FROM calculations
       WHERE company_id = ?
       ORDER BY is_builtin DESC, name COLLATE NOCASE ASC, created_at DESC`,
      [companyId]
    )).map(normalizeCalculationRow);

    return {
      calculations,
      presets: BUILTIN_PRESETS,
    };
  },

  async getCalculation(db: AppDatabase, companyId: string, calculationId: number) {
    const calculation = await db.first(
      `SELECT
         id,
         company_id,
         name,
         description,
         sql_text,
         output_mode,
         chart_type,
         chart_category_column,
         chart_value_column,
         chart_series_column,
         chart_config_json,
         chart_stacked,
         is_builtin,
         created_at,
         updated_at
       FROM calculations
       WHERE company_id = ? AND id = ?`,
      [companyId, calculationId]
    );

    if (!calculation) {
      throw new HTTPException(404, { message: "Calculation not found" });
    }

    return normalizeCalculationRow(calculation);
  },

  async validateSql(db: AppDatabase, sqlText: string, chartConfig: CalculationChartConfig) {
    const issues = validateReadOnlySql(sqlText);
    void chartConfig;

    if (issues.some((issue) => issue.level === "error")) {
      return {
        valid: false,
        issues,
        columns: [],
        rows: [],
      };
    }

    try {
      const rows = await previewSql(db, sqlText, 25);
      const columns = collectColumns(rows);
      return {
        valid: !issues.some((issue) => issue.level === "error"),
        issues,
        columns,
        rows,
      };
    } catch (error) {
      return {
        valid: false,
        issues: [...issues, { level: "error", message: error instanceof Error ? error.message : "Query failed" }],
        columns: [],
        rows: [],
      };
    }
  },

  async createCalculation(db: AppDatabase, companyId: string, input: CreateCalculationInput) {
    const normalizedChartConfig = normalizeChartConfig(input.chartConfig);
    const validation = await this.validateSql(db, input.sqlText, normalizedChartConfig);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.issues.find((issue) => issue.level === "error")?.message ?? "Invalid calculation",
      });
    }

    const createdAt = new Date().toISOString();
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      const result = await db.run(
        `INSERT INTO calculations (
           company_id,
           name,
           description,
           sql_text,
           output_mode,
           chart_type,
           chart_category_column,
           chart_value_column,
           chart_series_column,
           chart_config_json,
           chart_stacked,
           is_builtin,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          companyId,
          input.name.trim(),
          normalizeText(input.description),
          normalizeSql(input.sqlText),
          input.outputMode,
          normalizedChartConfig.type,
          normalizedChartConfig.categoryColumn,
          normalizedChartConfig.valueColumn,
          normalizedChartConfig.seriesColumn,
          JSON.stringify(normalizedChartConfig),
          normalizedChartConfig.stacked ? 1 : 0,
          createdAt,
          createdAt,
        ]
      );

      const calculationId = Number(result.lastRowId);
      await db.run(
        `INSERT INTO calculation_versions (
           calculation_id,
           version_number,
           name,
           description,
           sql_text,
           output_mode,
           chart_type,
           chart_category_column,
           chart_value_column,
           chart_series_column,
           chart_config_json,
           chart_stacked,
           created_at
         ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          calculationId,
          input.name.trim(),
          normalizeText(input.description),
          normalizeSql(input.sqlText),
          input.outputMode,
          normalizedChartConfig.type,
          normalizedChartConfig.categoryColumn,
          normalizedChartConfig.valueColumn,
          normalizedChartConfig.seriesColumn,
          JSON.stringify(normalizedChartConfig),
          normalizedChartConfig.stacked ? 1 : 0,
          createdAt,
        ]
      );

      await db.exec("COMMIT");
      return calculationId;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async updateCalculation(db: AppDatabase, companyId: string, input: UpdateCalculationInput) {
    const current = await this.getCalculation(db, companyId, input.calculationId);
    if (current.isBuiltin) {
      throw new HTTPException(400, { message: "Built-in calculations cannot be edited" });
    }

    const normalizedChartConfig = normalizeChartConfig(input.chartConfig);
    const validation = await this.validateSql(db, input.sqlText, normalizedChartConfig);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.issues.find((issue) => issue.level === "error")?.message ?? "Invalid calculation",
      });
    }

    const updatedAt = new Date().toISOString();
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run(
        `UPDATE calculations
         SET name = ?, description = ?, sql_text = ?, output_mode = ?, chart_type = ?, chart_category_column = ?, chart_value_column = ?, chart_series_column = ?, chart_config_json = ?, chart_stacked = ?, updated_at = ?
         WHERE company_id = ? AND id = ?`,
        [
          input.name.trim(),
          normalizeText(input.description),
          normalizeSql(input.sqlText),
          input.outputMode,
          normalizedChartConfig.type,
          normalizedChartConfig.categoryColumn,
          normalizedChartConfig.valueColumn,
          normalizedChartConfig.seriesColumn,
          JSON.stringify(normalizedChartConfig),
          normalizedChartConfig.stacked ? 1 : 0,
          updatedAt,
          companyId,
          input.calculationId,
        ]
      );

      const lastVersion = await db.first<{ version_number: number }>(
        "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM calculation_versions WHERE calculation_id = ?",
        [input.calculationId]
      );
      const nextVersion = (lastVersion?.version_number ?? 0) + 1;
      await db.run(
        `INSERT INTO calculation_versions (
           calculation_id,
           version_number,
           name,
           description,
           sql_text,
           output_mode,
           chart_type,
           chart_category_column,
           chart_value_column,
           chart_series_column,
           chart_config_json,
           chart_stacked,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.calculationId,
          nextVersion,
          input.name.trim(),
          normalizeText(input.description),
          normalizeSql(input.sqlText),
          input.outputMode,
          normalizedChartConfig.type,
          normalizedChartConfig.categoryColumn,
          normalizedChartConfig.valueColumn,
          normalizedChartConfig.seriesColumn,
          JSON.stringify(normalizedChartConfig),
          normalizedChartConfig.stacked ? 1 : 0,
          updatedAt,
        ]
      );

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async deleteCalculation(db: AppDatabase, companyId: string, calculationId: number) {
    const current = await this.getCalculation(db, companyId, calculationId);
    if (current.isBuiltin) {
      throw new HTTPException(400, { message: "Built-in calculations cannot be deleted" });
    }

    await db.run("DELETE FROM calculations WHERE company_id = ? AND id = ?", [companyId, calculationId]);
  },

  async createFromPreset(db: AppDatabase, companyId: string, input: CreateCalculationFromPresetInput) {
    const preset = getPresetRecord(input.presetKey);
    if (!preset) {
      throw new HTTPException(404, { message: "Preset not found" });
    }

    return await this.createCalculation(db, companyId, {
      name: preset.name,
      description: preset.description,
      sqlText: preset.sqlText,
      outputMode: preset.outputMode,
      chartConfig: preset.chartConfig,
    });
  },
};
