import type { CalculationPresetRecord } from "@shared/types/models";

const PRESET_TRANSLATION_KEYS: Record<string, { nameKey: string; descriptionKey: string }> = {
  austrian_monthly_overtime_by_worker: {
    nameKey: "calculations.presets.austrianMonthlyOvertimeByWorker.name",
    descriptionKey: "calculations.presets.austrianMonthlyOvertimeByWorker.description",
  },
  project_budget_burn: {
    nameKey: "calculations.presets.projectBudgetBurn.name",
    descriptionKey: "calculations.presets.projectBudgetBurn.description",
  },
  task_duration_rank: {
    nameKey: "calculations.presets.taskDurationRank.name",
    descriptionKey: "calculations.presets.taskDurationRank.description",
  },
  user_workload_last_30_days: {
    nameKey: "calculations.presets.userWorkloadLast30Days.name",
    descriptionKey: "calculations.presets.userWorkloadLast30Days.description",
  },
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function getCalculationPresetI18nKey(key: string) {
  return PRESET_TRANSLATION_KEYS[key] ?? null;
}

export function getCalculationPresetLabel(preset: CalculationPresetRecord, t: TranslateFn) {
  const keys = getCalculationPresetI18nKey(preset.key);
  return keys ? t(keys.nameKey) : preset.name;
}

export function getCalculationPresetDescription(preset: CalculationPresetRecord, t: TranslateFn) {
  const keys = getCalculationPresetI18nKey(preset.key);
  return keys ? t(keys.descriptionKey) : preset.description;
}
