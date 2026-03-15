import type { ReportRequestInput } from "@shared/types/api";

type StoredReportDraft = ReportRequestInput & {
  periodPreset: string;
  version: 1;
  savedAt: string;
};

const storagePrefix = "jtzt.reportDraft.";

function getStorageKey(id: string) {
  return `${storagePrefix}${id}`;
}

export function createReportDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 12);
  }

  return Math.random().toString(36).slice(2, 14);
}

export function saveReportDraft(id: string, draft: StoredReportDraft) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(getStorageKey(id), JSON.stringify(draft));
}

export function loadReportDraft(id: string | null) {
  if (typeof window === "undefined" || !id) return null;
  const rawValue = window.sessionStorage.getItem(getStorageKey(id));
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredReportDraft>;
    if (
      typeof parsed !== "object" ||
      !parsed ||
      !Array.isArray(parsed.userIds) ||
      !Array.isArray(parsed.columns) ||
      !Array.isArray(parsed.groupBy) ||
      typeof parsed.startDate !== "string" ||
      typeof parsed.endDate !== "string" ||
      typeof parsed.periodPreset !== "string"
    ) {
      return null;
    }

    return {
      version: 1,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      userIds: parsed.userIds.filter((value): value is number => typeof value === "number"),
      columns: parsed.columns.filter((value): value is string => typeof value === "string"),
      groupBy: parsed.groupBy.filter((value): value is string => typeof value === "string"),
      totalsOnly: Boolean(parsed.totalsOnly),
      periodPreset: parsed.periodPreset,
    };
  } catch {
    return null;
  }
}
