import type { CompanyOvertimeRule, CompanyOvertimeSettings, OvertimePresetId } from "../types/models";

export interface OvertimePresetDescriptor {
  id: OvertimePresetId;
  title: string;
  shortLabel: string;
  subtitle: string;
  countryCode: string | null;
  legalStatus: "statutory_baseline" | "conservative_default" | "reference_default" | "custom_template";
  highlights: string[];
  notes: string[];
}

function createRule(rule: CompanyOvertimeRule): CompanyOvertimeRule {
  return { ...rule };
}

function createAustriaPreset(): CompanyOvertimeSettings {
  return {
    version: 1,
    presetId: "at_default",
    countryCode: "AT",
    title: "Austria - Statutory Baseline",
    dailyOvertimeThresholdHours: 8,
    weeklyOvertimeThresholdHours: 40,
    averagingEnabled: true,
    averagingWeeks: 17,
    rules: [
      createRule({
        id: "standard-overtime",
        category: "standard_overtime",
        triggerKind: "daily_overtime",
        afterHours: 8,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 50,
        compensationType: "cash_or_time_off"
      }),
      createRule({
        id: "sunday-holiday",
        category: "sunday_holiday",
        triggerKind: "sunday_or_holiday",
        afterHours: null,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 0,
        compensationType: "cash"
      }),
      createRule({
        id: "night-shift",
        category: "night_shift",
        triggerKind: "night_shift",
        afterHours: null,
        windowStart: "22:00",
        windowEnd: "06:00",
        multiplierPercent: 0,
        compensationType: "cash"
      })
    ],
    payoutDecisionMode: "conditional",
    employeeChoiceAfterDailyHours: 10,
    employeeChoiceAfterWeeklyHours: 50,
    conflictResolution: "highest_only"
  };
}

function createGermanyPreset(): CompanyOvertimeSettings {
  return {
    ...createAustriaPreset(),
    presetId: "de_default",
    countryCode: "DE",
    title: "Germany - Conservative Default",
    dailyOvertimeThresholdHours: 8,
    weeklyOvertimeThresholdHours: 40,
    averagingEnabled: true,
    averagingWeeks: 24,
    rules: [
      createRule({
        id: "standard-overtime",
        category: "standard_overtime",
        triggerKind: "weekly_overtime",
        afterHours: 40,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 25,
        compensationType: "cash_or_time_off"
      }),
      createRule({
        id: "sunday-holiday",
        category: "sunday_holiday",
        triggerKind: "sunday_or_holiday",
        afterHours: null,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 50,
        compensationType: "cash"
      }),
      createRule({
        id: "night-shift",
        category: "night_shift",
        triggerKind: "night_shift",
        afterHours: null,
        windowStart: "23:00",
        windowEnd: "06:00",
        multiplierPercent: 25,
        compensationType: "cash"
      })
    ],
    payoutDecisionMode: "company",
    employeeChoiceAfterDailyHours: null,
    employeeChoiceAfterWeeklyHours: null,
    conflictResolution: "highest_only"
  };
}

function createFrancePreset(): CompanyOvertimeSettings {
  return {
    ...createAustriaPreset(),
    presetId: "fr_35h",
    countryCode: "FR",
    title: "France - 35h Reference",
    dailyOvertimeThresholdHours: 7,
    weeklyOvertimeThresholdHours: 35,
    averagingEnabled: false,
    averagingWeeks: 12,
    rules: [
      createRule({
        id: "standard-overtime",
        category: "standard_overtime",
        triggerKind: "weekly_overtime",
        afterHours: 35,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 25,
        compensationType: "cash"
      }),
      createRule({
        id: "sunday-holiday",
        category: "sunday_holiday",
        triggerKind: "sunday_or_holiday",
        afterHours: null,
        windowStart: null,
        windowEnd: null,
        multiplierPercent: 100,
        compensationType: "cash"
      }),
      createRule({
        id: "night-shift",
        category: "night_shift",
        triggerKind: "night_shift",
        afterHours: null,
        windowStart: "21:00",
        windowEnd: "06:00",
        multiplierPercent: 30,
        compensationType: "cash"
      })
    ],
    payoutDecisionMode: "company",
    employeeChoiceAfterDailyHours: null,
    employeeChoiceAfterWeeklyHours: null,
    conflictResolution: "stack"
  };
}

function createCustomPreset(): CompanyOvertimeSettings {
  return {
    ...createAustriaPreset(),
    presetId: "eu_custom",
    countryCode: null,
    title: "Custom EU Setup",
    payoutDecisionMode: "conditional",
    employeeChoiceAfterDailyHours: 10,
    employeeChoiceAfterWeeklyHours: 50,
    conflictResolution: "stack"
  };
}

export const overtimePresetDescriptors: OvertimePresetDescriptor[] = [
  {
    id: "at_default",
    title: "Austria - Statutory Baseline",
    shortLabel: "Austria",
    subtitle: "Exact Austrian baseline for 8h / 40h overtime with conditional employee choice.",
    countryCode: "AT",
    legalStatus: "statutory_baseline",
    highlights: [
      "Standard overtime starts above 8 hours per day or 40 hours per week.",
      "Baseline premium is +50% or equivalent 1:1.5 time off.",
      "Employee choice activates above 10 hours per day or 50 hours per week."
    ],
    notes: [
      "Sunday, holiday, and night premiums are left neutral here because they are not treated as universal Austrian statutory defaults in this preset.",
      "Use collective agreements or company rules to add sector-specific premiums."
    ]
  },
  {
    id: "de_default",
    title: "Germany - Conservative Default",
    shortLabel: "Germany",
    subtitle: "A conservative starting profile for German overtime administration.",
    countryCode: "DE",
    legalStatus: "conservative_default",
    highlights: [
      "Weekly-focused standard overtime trigger.",
      "Moderate default premiums for Sunday and night work.",
      "Company-controlled payout by default."
    ],
    notes: [
      "This is a practical preset, not a claim of one universal German statutory premium model.",
      "Collective agreements and sector rules often control the real premium structure."
    ]
  },
  {
    id: "fr_35h",
    title: "France - 35h Reference",
    shortLabel: "France",
    subtitle: "Reference setup centered around the 35-hour workweek.",
    countryCode: "FR",
    legalStatus: "reference_default",
    highlights: [
      "Weekly trigger starts at 35 hours.",
      "Strong Sunday and night reference premiums.",
      "Built for easy override by agreement."
    ],
    notes: [
      "Use this as a clean starting point, then align it with your convention collective or company agreement."
    ]
  },
  {
    id: "eu_custom",
    title: "Custom EU Setup",
    shortLabel: "Custom EU",
    subtitle: "A flexible template for building country-specific or agreement-specific overtime policies.",
    countryCode: null,
    legalStatus: "custom_template",
    highlights: [
      "Starts with an Austria-style structure but keeps everything editable.",
      "Good base for collective-agreement-heavy organizations.",
      "Supports multiple stacked or special-case rules."
    ],
    notes: [
      "Use this when you do not want any country preset to imply legal completeness."
    ]
  }
];

export function getOvertimePresetDescriptor(presetId: OvertimePresetId) {
  return overtimePresetDescriptors.find((preset) => preset.id === presetId) ?? overtimePresetDescriptors[0];
}

export function createDefaultOvertimeSettings(): CompanyOvertimeSettings {
  return createAustriaPreset();
}

export function createOvertimePreset(presetId: OvertimePresetId): CompanyOvertimeSettings {
  if (presetId === "de_default") {
    return createGermanyPreset();
  }

  if (presetId === "fr_35h") {
    return createFrancePreset();
  }

  if (presetId === "eu_custom") {
    return createCustomPreset();
  }

  return createAustriaPreset();
}

export function normalizeOvertimeSettings(value: unknown): CompanyOvertimeSettings {
  const fallback = createDefaultOvertimeSettings();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<CompanyOvertimeSettings> & { employeeChoiceAfterHours?: unknown };
  const presetId = candidate.presetId === "at_default" || candidate.presetId === "de_default" || candidate.presetId === "fr_35h" || candidate.presetId === "eu_custom"
    ? candidate.presetId
    : fallback.presetId;
  const base = createOvertimePreset(presetId);
  const legacyChoiceThreshold = typeof candidate.employeeChoiceAfterHours === "number" ? candidate.employeeChoiceAfterHours : null;

  return {
    ...base,
    countryCode: typeof candidate.countryCode === "string" || candidate.countryCode === null ? candidate.countryCode : base.countryCode,
    title: typeof candidate.title === "string" && candidate.title.trim().length > 0 ? candidate.title : base.title,
    dailyOvertimeThresholdHours: typeof candidate.dailyOvertimeThresholdHours === "number" ? candidate.dailyOvertimeThresholdHours : base.dailyOvertimeThresholdHours,
    weeklyOvertimeThresholdHours: typeof candidate.weeklyOvertimeThresholdHours === "number" ? candidate.weeklyOvertimeThresholdHours : base.weeklyOvertimeThresholdHours,
    averagingEnabled: typeof candidate.averagingEnabled === "boolean" ? candidate.averagingEnabled : base.averagingEnabled,
    averagingWeeks: typeof candidate.averagingWeeks === "number" ? candidate.averagingWeeks : base.averagingWeeks,
    rules: Array.isArray(candidate.rules) ? candidate.rules.map((rule, index) => ({
      id: typeof rule?.id === "string" && rule.id.length > 0 ? rule.id : `rule-${index + 1}`,
      category: rule?.category === "standard_overtime" || rule?.category === "sunday_holiday" || rule?.category === "night_shift" || rule?.category === "special"
        ? rule.category
        : "special",
      triggerKind: rule?.triggerKind === "daily_overtime" || rule?.triggerKind === "weekly_overtime" || rule?.triggerKind === "sunday_or_holiday" || rule?.triggerKind === "night_shift" || rule?.triggerKind === "daily_after_hours" || rule?.triggerKind === "weekly_after_hours"
        ? rule.triggerKind
        : "daily_after_hours",
      afterHours: typeof rule?.afterHours === "number" ? rule.afterHours : null,
      windowStart: typeof rule?.windowStart === "string" ? rule.windowStart : null,
      windowEnd: typeof rule?.windowEnd === "string" ? rule.windowEnd : null,
      multiplierPercent: typeof rule?.multiplierPercent === "number" ? rule.multiplierPercent : 50,
      compensationType: rule?.compensationType === "cash" || rule?.compensationType === "time_off" || rule?.compensationType === "cash_or_time_off"
        ? rule.compensationType
        : "cash",
    })) : base.rules,
    payoutDecisionMode: candidate.payoutDecisionMode === "company" || candidate.payoutDecisionMode === "employee" || candidate.payoutDecisionMode === "conditional"
      ? candidate.payoutDecisionMode
      : base.payoutDecisionMode,
    employeeChoiceAfterDailyHours: typeof candidate.employeeChoiceAfterDailyHours === "number"
      ? candidate.employeeChoiceAfterDailyHours
      : legacyChoiceThreshold,
    employeeChoiceAfterWeeklyHours: typeof candidate.employeeChoiceAfterWeeklyHours === "number"
      ? candidate.employeeChoiceAfterWeeklyHours
      : base.employeeChoiceAfterWeeklyHours,
    conflictResolution: candidate.conflictResolution === "stack" || candidate.conflictResolution === "highest_only"
      ? candidate.conflictResolution
      : base.conflictResolution
  };
}
