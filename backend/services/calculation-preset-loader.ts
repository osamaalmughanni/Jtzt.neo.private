import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CompanySettings, CalculationPresetRecord } from "../../shared/types/models";

const PRESET_DIR_CANDIDATES = [
  path.join(process.cwd(), "backend", "services", "calculation-presets"),
  path.join(process.cwd(), "dist", "backend", "services", "calculation-presets"),
];

function resolvePresetDir() {
  for (const candidate of PRESET_DIR_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return PRESET_DIR_CANDIDATES[0];
}

function normalizePresetRecord(preset: Omit<CalculationPresetRecord, "sqlText"> & { sqlText?: string }, sqlText: string): CalculationPresetRecord {
  return {
    key: preset.key,
    name: preset.name,
    description: preset.description,
    sqlText,
    outputMode: preset.outputMode,
    chartConfig: preset.chartConfig,
  };
}

export async function loadBuiltinCalculationPresets(_settings: Pick<CompanySettings, "locale" | "dateTimeFormat" | "currency" | "timeZone">) {
  const presetDir = resolvePresetDir();
  if (!fs.existsSync(presetDir)) {
    return [] as CalculationPresetRecord[];
  }

  const files = fs
    .readdirSync(presetDir)
    .filter((file) => file.endsWith(".js"))
    .sort((left, right) => left.localeCompare(right));

  return await Promise.all(files.map(async (fileName) => {
    const filePath = path.join(presetDir, fileName);
    const moduleUrl = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
    const module = (await import(moduleUrl)) as {
      preset?: Omit<CalculationPresetRecord, "sqlText"> & { sqlText?: string };
      default?: Omit<CalculationPresetRecord, "sqlText"> & { sqlText?: string };
    };
    const preset = module.preset ?? module.default;
    if (!preset) {
      throw new Error(`Preset module ${fileName} does not export a preset`);
    }

    return normalizePresetRecord(preset, preset.sqlText ?? "");
  }));
}
