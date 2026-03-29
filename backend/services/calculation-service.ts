import { HTTPException } from "hono/http-exception";
import { desc, eq, sql } from "drizzle-orm";
import type {
  CalculationPresetRecord,
  CalculationRecord,
  CalculationOutputMode,
  CalculationChartConfig,
} from "../../shared/types/models";
import type {
  CalculationValidationIssue,
  CreateCalculationFromPresetInput,
  CreateCalculationInput,
  UpdateCalculationInput,
} from "../../shared/types/api";
import { calculations } from "../db/schema";
import { mapCalculation } from "../db/mappers";
import type { NodeDatabase } from "../runtime/types";
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

async function previewSql(db: NodeDatabase, sqlText: string, limit = 50) {
  const previewSqlText = `SELECT * FROM (${normalizeSql(sqlText)}) AS calculation_preview LIMIT ${limit}`;
  return db.sqlite.prepare(previewSqlText).all() as PreviewRow[];
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
  async listPresets(db: NodeDatabase, companyId: string): Promise<CalculationPresetRecord[]> {
    const settings = await settingsService.getSettings(db, companyId);
    return await loadBuiltinCalculationPresets(settings);
  },

  async listCalculations(db: NodeDatabase, companyId: string) {
    const settings = await settingsService.getSettings(db, companyId);
    const presets = await loadBuiltinCalculationPresets(settings);
    const presetsByKey = new Map(presets.map((preset) => [preset.key, preset]));
    const calculationRows = await db.orm.select({
      id: calculations.id,
      name: calculations.name,
      description: calculations.description,
      sql_text: calculations.sqlText,
      output_mode: calculations.outputMode,
      chart_type: calculations.chartType,
      chart_category_column: calculations.chartCategoryColumn,
      chart_value_column: calculations.chartValueColumn,
      chart_series_column: calculations.chartSeriesColumn,
      chart_config_json: calculations.chartConfigJson,
      chart_stacked: calculations.chartStacked,
      is_builtin: calculations.isBuiltin,
      builtin_key: calculations.builtinKey,
      created_at: calculations.createdAt,
      updated_at: calculations.updatedAt,
    }).from(calculations)
      .orderBy(desc(calculations.isBuiltin), sql`name COLLATE NOCASE ASC`, desc(calculations.createdAt));
    const hydratedCalculations = calculationRows
      .map(normalizeCalculationRow)
      .map((calculation: CalculationRecord) => hydrateBuiltinCalculation(calculation, presetsByKey));

    return {
      calculations: hydratedCalculations,
      presets,
    };
  },

  async getCalculation(db: NodeDatabase, companyId: string, calculationId: number) {
    const calculation = await db.orm.select({
      id: calculations.id,
      name: calculations.name,
      description: calculations.description,
      sql_text: calculations.sqlText,
      output_mode: calculations.outputMode,
      chart_type: calculations.chartType,
      chart_category_column: calculations.chartCategoryColumn,
      chart_value_column: calculations.chartValueColumn,
      chart_series_column: calculations.chartSeriesColumn,
      chart_config_json: calculations.chartConfigJson,
      chart_stacked: calculations.chartStacked,
      is_builtin: calculations.isBuiltin,
      builtin_key: calculations.builtinKey,
      created_at: calculations.createdAt,
      updated_at: calculations.updatedAt,
    }).from(calculations).where(eq(calculations.id, calculationId)).get();

    if (!calculation) {
      throw new HTTPException(404, { message: "Calculation not found" });
    }

    const settings = await settingsService.getSettings(db, companyId);
    const presets = await loadBuiltinCalculationPresets(settings);
    const presetsByKey = new Map(presets.map((preset) => [preset.key, preset]));
    return hydrateBuiltinCalculation(normalizeCalculationRow(calculation), presetsByKey);
  },

  async validateSql(db: NodeDatabase, sqlText: string) {
    const issues = validateReadOnlySql(sqlText);

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

  async createCalculation(db: NodeDatabase, companyId: string, input: CreateCalculationInput) {
    const normalizedChartConfig = normalizeChartConfig(input.chartConfig);
    const validation = await this.validateSql(db, input.sqlText);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.issues.find((issue) => issue.level === "error")?.message ?? "Invalid calculation",
      });
    }

    const createdAt = new Date().toISOString();
    const result = await db.orm.insert(calculations).values({
      name: input.name.trim(),
      description: normalizeText(input.description),
      sqlText: normalizeSql(input.sqlText),
      outputMode: input.outputMode,
      chartType: normalizedChartConfig.type,
      chartCategoryColumn: normalizedChartConfig.categoryColumn,
      chartValueColumn: normalizedChartConfig.valueColumn,
      chartSeriesColumn: normalizedChartConfig.seriesColumn,
      chartConfigJson: JSON.stringify(normalizedChartConfig),
      chartStacked: normalizedChartConfig.stacked ? 1 : 0,
      isBuiltin: 0,
      createdAt,
      updatedAt: createdAt,
    }).returning({ id: calculations.id });
    return Number(result[0]?.id);
  },

  async updateCalculation(db: NodeDatabase, companyId: string, input: UpdateCalculationInput) {
    const current = await this.getCalculation(db, companyId, input.calculationId);
    if (current.isBuiltin) {
      throw new HTTPException(400, { message: "Built-in calculations cannot be edited" });
    }

    const normalizedChartConfig = normalizeChartConfig(input.chartConfig);
    const validation = await this.validateSql(db, input.sqlText);
    if (!validation.valid) {
      throw new HTTPException(400, {
        message: validation.issues.find((issue) => issue.level === "error")?.message ?? "Invalid calculation",
      });
    }

    const updatedAt = new Date().toISOString();
    await db.orm.update(calculations).set({
      name: input.name.trim(),
      description: normalizeText(input.description),
      sqlText: normalizeSql(input.sqlText),
      outputMode: input.outputMode,
      chartType: normalizedChartConfig.type,
      chartCategoryColumn: normalizedChartConfig.categoryColumn,
      chartValueColumn: normalizedChartConfig.valueColumn,
      chartSeriesColumn: normalizedChartConfig.seriesColumn,
      chartConfigJson: JSON.stringify(normalizedChartConfig),
      chartStacked: normalizedChartConfig.stacked ? 1 : 0,
      updatedAt,
    }).where(eq(calculations.id, input.calculationId)).run();
  },

  async deleteCalculation(db: NodeDatabase, companyId: string, calculationId: number) {
    const current = await this.getCalculation(db, companyId, calculationId);
    if (current.isBuiltin) {
      throw new HTTPException(400, { message: "Built-in calculations cannot be deleted" });
    }

    await db.orm.delete(calculations).where(eq(calculations.id, calculationId)).run();
  },

  async createFromPreset(db: NodeDatabase, companyId: string, input: CreateCalculationFromPresetInput) {
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
