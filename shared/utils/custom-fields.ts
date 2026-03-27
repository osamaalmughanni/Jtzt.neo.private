import type { ReportRequestInput } from "@shared/types/api";
import type {
  CompanyCustomField,
  CompanyCustomFieldOption,
  CompanyCustomFieldTarget,
  CompanySettings,
  CustomFieldTargetScope,
  TimeEntryType,
} from "@shared/types/models";

const BASE_REPORT_COLUMNS = new Set([
  "user",
  "role",
  "type",
  "project",
  "task",
  "date",
  "start",
  "finish",
  "duration",
  "overtime_state",
  "overtime_timeline",
  "note",
  "cost",
  "entries",
  "month",
]);

const BASE_GROUP_COLUMNS = new Set([
  "user",
  "role",
  "type",
  "date",
  "month",
  "project",
  "task",
]);

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

const TIME_ENTRY_TARGETS = new Set<TimeEntryType>(["work", "vacation", "sick_leave", "time_off_in_lieu"]);
const CUSTOM_FIELD_SCOPES = new Set<CustomFieldTargetScope>(["time_entry", "user", "project", "task"]);

export function buildCustomFieldCanonicalKey(fieldId: string) {
  return `custom:${fieldId}`;
}

export function getCustomFieldLabel(field: CompanyCustomField) {
  const cleaned = field.label.trim();
  return cleaned.length > 0 ? cleaned : field.id;
}

export function getCustomFieldAliases(field: CompanyCustomField) {
  const label = getCustomFieldLabel(field);
  return [
    field.id,
    buildCustomFieldCanonicalKey(field.id),
    `field-${field.id}`,
    label,
  ];
}

export function buildCustomFieldLabelLookup(customFields: CompanySettings["customFields"]) {
  const labels = new Map<string, string>();

  for (const field of customFields) {
    const label = getCustomFieldLabel(field);
    for (const alias of getCustomFieldAliases(field)) {
      labels.set(normalizeLookupValue(alias), label);
    }
  }

  return labels;
}

function buildCustomFieldAliasMap(customFields: CompanySettings["customFields"]) {
  const aliases = new Map<string, string>();

  for (const field of customFields) {
    const canonicalKey = buildCustomFieldCanonicalKey(field.id);
    for (const alias of getCustomFieldAliases(field)) {
      aliases.set(normalizeLookupValue(alias), canonicalKey);
    }
  }

  return aliases;
}

export function resolveCustomFieldLabel(
  value: string,
  customFieldLabels: Map<string, string>,
) {
  return customFieldLabels.get(normalizeLookupValue(value)) ?? null;
}

function normalizeFieldKey(
  value: string,
  customFieldAliases: Map<string, string>,
  allowedBaseKeys: Set<string>,
) {
  if (allowedBaseKeys.has(value)) {
    return value;
  }

  return customFieldAliases.get(normalizeLookupValue(value)) ?? null;
}

function dedupe<T>(values: T[]) {
  return values.filter((value, index, array) => array.indexOf(value) === index);
}

function isKnownFieldType(value: string): value is CompanyCustomField["type"] {
  return value === "text" || value === "number" || value === "date" || value === "boolean" || value === "select";
}

function normalizeCustomFieldTargetScope(value: unknown): CustomFieldTargetScope | null {
  if (typeof value !== "string") {
    return null;
  }

  return CUSTOM_FIELD_SCOPES.has(value as CustomFieldTargetScope) ? (value as CustomFieldTargetScope) : null;
}

function normalizeCustomFieldTargets(targets: unknown): CompanyCustomFieldTarget[] {
  if (!Array.isArray(targets)) {
    return [];
  }

  const scopeMap = new Map<CustomFieldTargetScope, CompanyCustomFieldTarget>();

  for (const target of targets) {
    if (typeof target === "string") {
      if (TIME_ENTRY_TARGETS.has(target as TimeEntryType)) {
        const current = scopeMap.get("time_entry") ?? { scope: "time_entry", entryTypes: [] };
        current.entryTypes = dedupe([...(current.entryTypes ?? []), target as TimeEntryType]);
        scopeMap.set("time_entry", current);
      }
      continue;
    }

    if (!target || typeof target !== "object") {
      continue;
    }

    const scope = normalizeCustomFieldTargetScope((target as { scope?: unknown }).scope);
    if (!scope) {
      continue;
    }

    if (scope === "time_entry") {
      const rawEntryTypes = (target as { entryTypes?: unknown }).entryTypes;
      const entryTypes = Array.isArray(rawEntryTypes)
        ? rawEntryTypes.filter((value: unknown): value is TimeEntryType => typeof value === "string" && TIME_ENTRY_TARGETS.has(value as TimeEntryType))
        : [];
      const current = scopeMap.get("time_entry") ?? { scope: "time_entry", entryTypes: [] };
      current.entryTypes = dedupe([...(current.entryTypes ?? []), ...entryTypes]);
      scopeMap.set("time_entry", current);
      continue;
    }

    scopeMap.set(scope, { scope });
  }

  const normalized: CompanyCustomFieldTarget[] = [];
  for (const target of scopeMap.values()) {
    if (target.scope !== "time_entry") {
      normalized.push(target);
      continue;
    }

    const entryTypes = dedupe((target.entryTypes ?? []).filter((value): value is TimeEntryType => TIME_ENTRY_TARGETS.has(value)));
    normalized.push({
      scope: "time_entry",
      entryTypes: entryTypes.length > 0 ? entryTypes : ["work"],
    });
  }

  return normalized;
}

function normalizeCustomFieldOption(option: Partial<CompanyCustomFieldOption> & { id?: string; label?: string }) {
  const id = typeof option.id === "string" && option.id.trim().length > 0 ? option.id.trim() : crypto.randomUUID();
  const label = typeof option.label === "string" ? option.label.trim() : "";

  return {
    id,
    label,
    value: id,
  };
}

export function normalizeCustomField(field: CompanyCustomField): CompanyCustomField {
  const rawType = typeof field.type === "string" && isKnownFieldType(field.type) ? field.type : "text";
  const options = Array.isArray(field.options) ? field.options.map((option) => normalizeCustomFieldOption(option)) : [];

  return {
    id: typeof field.id === "string" && field.id.trim().length > 0 ? field.id.trim() : crypto.randomUUID(),
    label: typeof field.label === "string" ? field.label.trim() : "",
    type: rawType,
    targets: normalizeCustomFieldTargets(field.targets),
    required: Boolean(field.required),
    placeholder: typeof field.placeholder === "string" ? field.placeholder.trim() || null : null,
    options: rawType === "select" ? options : [],
  };
}

export function normalizeCustomFields(customFields: CompanySettings["customFields"]) {
  return customFields.map((field) => normalizeCustomField(field));
}

export function getRemovedCustomFieldIds(
  previousCustomFields: CompanySettings["customFields"],
  nextCustomFields: CompanySettings["customFields"],
) {
  const nextIds = new Set(nextCustomFields.map((field) => field.id));
  return previousCustomFields
    .map((field) => field.id)
    .filter((fieldId) => !nextIds.has(fieldId));
}

export function stripRemovedCustomFieldValues(
  customFieldValues: Record<string, string | number | boolean>,
  removedFieldIds: string[],
) {
  if (removedFieldIds.length === 0) {
    return customFieldValues;
  }

  const removedIds = new Set(removedFieldIds);
  const nextValues: Record<string, string | number | boolean> = {};
  for (const [fieldId, value] of Object.entries(customFieldValues)) {
    if (!removedIds.has(fieldId)) {
      nextValues[fieldId] = value;
    }
  }

  return nextValues;
}

export function getCustomFieldsForTarget(
  customFields: CompanySettings["customFields"],
  target: { scope: CustomFieldTargetScope; entryType?: TimeEntryType },
) {
  return customFields.filter((field) =>
    field.targets.some((fieldTarget) =>
      fieldTarget.scope === target.scope && (
        fieldTarget.scope !== "time_entry"
          ? true
          : target.entryType !== undefined
            ? (fieldTarget.entryTypes ?? []).includes(target.entryType)
            : true
      )
    )
  );
}

export function isCustomFieldTargetedTo(field: CompanyCustomField, target: { scope: CustomFieldTargetScope; entryType?: TimeEntryType }) {
  return field.targets.some((fieldTarget) =>
    fieldTarget.scope === target.scope && (
      fieldTarget.scope !== "time_entry"
        ? true
        : target.entryType !== undefined
          ? (fieldTarget.entryTypes ?? []).includes(target.entryType)
          : true
    )
  );
}

export function normalizeCustomFieldValuesForTarget(
  customFields: CompanySettings["customFields"],
  target: { scope: CustomFieldTargetScope; entryType?: TimeEntryType },
  values: Record<string, string | number | boolean>,
) {
  const applicableFields = getCustomFieldsForTarget(customFields, target);
  const normalizedValues: Record<string, string | number | boolean> = {};

  for (const field of applicableFields) {
    const rawValue = values[field.id];
    const normalizedValue = normalizeCustomFieldValue(field, rawValue);
    if (normalizedValue !== undefined) {
      normalizedValues[field.id] = normalizedValue;
    }
  }

  return normalizedValues;
}

export function validateCustomFieldValuesForTarget(
  customFields: CompanySettings["customFields"],
  target: { scope: CustomFieldTargetScope; entryType?: TimeEntryType },
  values: Record<string, string | number | boolean>,
) {
  const applicableFields = getCustomFieldsForTarget(customFields, target);
  const normalizedValues: Record<string, string | number | boolean> = {};

  for (const field of applicableFields) {
    const rawValue = values[field.id];
    const normalizedValue = normalizeCustomFieldValue(field, rawValue);

    if (field.type === "select" && hasCustomFieldValue(rawValue)) {
      if (typeof rawValue !== "string") {
        throw new Error(`${field.label} has an invalid selection`);
      }

      const optionMatches = field.options.some((option) => option.id === rawValue);
      if (!optionMatches) {
        throw new Error(`${field.label} has an invalid selection`);
      }
    }

    if (field.required && !hasCustomFieldValue(normalizedValue)) {
      throw new Error(`${field.label} is required`);
    }

    if (normalizedValue !== undefined) {
      normalizedValues[field.id] = normalizedValue;
    }
  }

  return normalizedValues;
}

function hasCustomFieldValue(value: string | number | boolean | undefined) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

export function buildCustomFieldValueLabelLookup(customFields: CompanySettings["customFields"]) {
  const labels = new Map<string, string>();

  for (const field of customFields) {
    for (const option of field.options) {
      const label = option.label.trim();
      if (!label) {
        continue;
      }

      labels.set(normalizeLookupValue(`${field.id}:${option.id}`), label);
    }
  }

  return labels;
}

export function resolveCustomFieldValueLabel(
  field: CompanyCustomField | undefined,
  rawValue: string | number | boolean | null | undefined,
  customFieldValueLabels: Map<string, string>,
) {
  if (!field || rawValue === null || rawValue === undefined) {
    return null;
  }

  if (field.type === "boolean") {
    return typeof rawValue === "boolean" ? (rawValue ? "Yes" : "No") : String(rawValue);
  }

  if (field.type === "select") {
    const value = String(rawValue);
    return customFieldValueLabels.get(normalizeLookupValue(`${field.id}:${value}`)) ?? value;
  }

  return String(rawValue);
}

export function normalizeCustomFieldValue(
  field: CompanyCustomField | undefined,
  rawValue: string | number | boolean | null | undefined,
) : string | number | boolean | undefined {
  if (!field || rawValue === null || rawValue === undefined) {
    return undefined;
  }

  if (field.type !== "select" || typeof rawValue !== "string") {
    return rawValue;
  }

  const normalized = normalizeLookupValue(rawValue);
  const match = field.options.find((option) => {
    return normalizeLookupValue(option.id) === normalized;
  });

  return match ? match.id : rawValue;
}

export function normalizeReportDraftFields(
  draft: Pick<ReportRequestInput, "columns" | "groupBy">,
  settings: Pick<CompanySettings, "customFields">,
) {
  const aliases = buildCustomFieldAliasMap(settings.customFields);
  const columns = dedupe(
    draft.columns
      .map((value) => normalizeFieldKey(value, aliases, BASE_REPORT_COLUMNS))
      .filter((value): value is string => value !== null),
  );
  const groupBy = dedupe(
    draft.groupBy
      .map((value) => normalizeFieldKey(value, aliases, BASE_GROUP_COLUMNS))
      .filter((value): value is string => value !== null),
  );

  return { columns, groupBy };
}
