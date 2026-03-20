import type { ReportRequestInput } from "@shared/types/api";
import type { CompanySettings } from "@shared/types/models";

const BASE_REPORT_COLUMNS = new Set([
  "user",
  "role",
  "type",
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
]);

export function getCustomFieldOptionLabel(field: CompanySettings["customFields"][number]) {
  const cleaned = field.label.trim();
  if (cleaned.length > 0) {
    return cleaned;
  }

  return field.id;
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export function buildCustomFieldCanonicalKey(fieldId: string) {
  return `custom:${fieldId}`;
}

function getCustomFieldAliases(field: CompanySettings["customFields"][number]) {
  const label = getCustomFieldOptionLabel(field);
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
    const label = getCustomFieldOptionLabel(field);
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
