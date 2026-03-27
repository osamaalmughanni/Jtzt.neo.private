import type { ReportRequestInput } from "@shared/types/api";
import type { CompanyCustomField, CompanyCustomFieldOption, CompanySettings } from "@shared/types/models";

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

function dedupe(values: string[]) {
  return values.filter((value, index, array) => array.indexOf(value) === index);
}

function isKnownFieldType(value: string): value is CompanyCustomField["type"] {
  return value === "text" || value === "number" || value === "date" || value === "boolean" || value === "select";
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
    targets: Array.isArray(field.targets) ? field.targets.filter((target): target is CompanyCustomField["targets"][number] => target === "work" || target === "vacation" || target === "time_off_in_lieu" || target === "sick_leave") : [],
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
