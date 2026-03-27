import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CalculationPresetRecord } from "../../shared/types/models";

const PRESET_DIR = path.join(process.cwd(), "backend", "services", "calculation-presets");

async function loadPresetModule(fileName: string) {
  const filePath = path.join(PRESET_DIR, fileName);
  const moduleUrl = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
  const module = (await import(moduleUrl)) as {
    preset?: CalculationPresetRecord;
    default?: CalculationPresetRecord;
  };

  const preset = module.preset ?? module.default;
  if (!preset) {
    throw new Error(`Preset module ${fileName} does not export a preset`);
  }

  return preset;
}

export async function loadBuiltinCalculationPresets() {
  if (!fs.existsSync(PRESET_DIR)) {
    return [] as CalculationPresetRecord[];
  }

  const files = fs
    .readdirSync(PRESET_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort((left, right) => left.localeCompare(right));

  return await Promise.all(files.map((fileName) => loadPresetModule(fileName)));
}
