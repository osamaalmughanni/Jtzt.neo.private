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
import { loadBuiltinCalculationPresets } from "./calculation-preset-loader";
import { settingsService } from "./settings-service";

type PreviewRow = Record<string, string | number | null>;

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

function hydrateBuiltinCalculation(calculation: CalculationRecord, presetsByKey: Map<string, CalculationPresetRecord>) {
  if (!calculation.isBuiltin || !calculation.builtinKey) {
    return calculation;
  }

  const preset = presetsByKey.get(calculation.builtinKey);
  if (!preset) {
    return calculation;
  }

  return {
    ...calculation,
    sqlText: preset.sqlText,
    name: preset.name,
    description: preset.description,
    outputMode: preset.outputMode,
    chartConfig: preset.chartConfig,
  };
}

export const calculationService = {
  async listPresets(db: AppDatabase, companyId: string): Promise<CalculationPresetRecord[]> {
    const settings = await settingsService.getSettings(db, companyId);
    return await loadBuiltinCalculationPresets(settings);
  },

  async listCalculations(db: AppDatabase, companyId: string) {
    const settings = await settingsService.getSettings(db, companyId);
    const presets = await loadBuiltinCalculationPresets(settings);
    const presetsByKey = new Map(presets.map((preset) => [preset.key, preset]));
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
         builtin_key,
         created_at,
         updated_at
       FROM calculations
       WHERE company_id = ?
       ORDER BY is_builtin DESC, name COLLATE NOCASE ASC, created_at DESC`,
      [companyId]
    )).map(normalizeCalculationRow).map((calculation) => hydrateBuiltinCalculation(calculation, presetsByKey));

    return {
      calculations,
      presets,
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
         builtin_key,
         created_at,
         updated_at
       FROM calculations
       WHERE company_id = ? AND id = ?`,
      [companyId, calculationId]
    );

    if (!calculation) {
      throw new HTTPException(404, { message: "Calculation not found" });
    }

    const settings = await settingsService.getSettings(db, companyId);
    const presets = await loadBuiltinCalculationPresets(settings);
    const presetsByKey = new Map(presets.map((preset) => [preset.key, preset]));
    return hydrateBuiltinCalculation(normalizeCalculationRow(calculation), presetsByKey);
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
    const settings = await settingsService.getSettings(db, companyId);
    const preset = (await loadBuiltinCalculationPresets(settings)).find((item) => item.key === input.presetKey) ?? null;
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
