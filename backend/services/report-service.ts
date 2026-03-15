import { HTTPException } from "hono/http-exception";
import { diffMinutes } from "../../shared/utils/time";
import type { ReportColumnDefinition, ReportRequestInput } from "../../shared/types/api";
import type { CompanyCustomField, TimeEntryType, UserContract } from "../../shared/types/models";
import { getCompanyDb } from "../db/company-db";
import { calculateLeaveCompensation } from "./time-entry-metrics-service";
import { settingsService } from "./settings-service";

type ReportRow = {
  id: number;
  user_id: number;
  full_name: string;
  role: string;
  entry_type: TimeEntryType;
  entry_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  custom_field_values_json: string;
};

type ContractRow = UserContract;

const baseColumns: Record<string, ReportColumnDefinition> = {
  user: { key: "user", label: "User", kind: "text" },
  role: { key: "role", label: "Role", kind: "text" },
  type: { key: "type", label: "Type", kind: "text" },
  date: { key: "date", label: "Date", kind: "date" },
  start: { key: "start", label: "Start", kind: "datetime" },
  finish: { key: "finish", label: "Finish", kind: "datetime" },
  duration: { key: "duration", label: "Duration", kind: "duration" },
  note: { key: "note", label: "Note", kind: "text" },
  cost: { key: "cost", label: "Cost", kind: "currency" },
  entries: { key: "entries", label: "Entries", kind: "number" },
  month: { key: "month", label: "Month", kind: "text" }
};

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, string | number | boolean>;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function buildInClause(values: number[]) {
  return values.map(() => "?").join(", ");
}

function normalizeRole(role: string) {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Employee";
}

function getTypeLabel(entryType: TimeEntryType) {
  if (entryType === "work") return "Working";
  if (entryType === "vacation") return "Vacation";
  return "Sick leave";
}

function getMonthKey(day: string) {
  return day.slice(0, 7);
}

function getColumnDefinition(key: string, customFields: CompanyCustomField[]): ReportColumnDefinition | null {
  if (key.startsWith("custom:")) {
    const field = customFields.find((item) => `custom:${item.id}` === key);
    if (!field) return null;
    return {
      key,
      label: field.label,
      kind: field.type === "date" ? "date" : field.type === "number" ? "number" : "text"
    };
  }

  return baseColumns[key] ?? null;
}

function resolveContractRate(contracts: ContractRow[], day: string) {
  let match: ContractRow | null = null;
  for (const contract of contracts) {
    if (contract.startDate <= day && (contract.endDate === null || contract.endDate >= day)) {
      if (!match || contract.startDate >= match.startDate) {
        match = contract;
      }
    }
  }

  return match?.paymentPerHour ?? 0;
}

async function getHolidaySet(databasePath: string, country: string, startDate: string, endDate: string) {
  const holidaySet = new Set<string>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));

  while (year <= finalYear) {
    const response = await settingsService.getPublicHolidays(databasePath, country, year);
    for (const holiday of response.holidays) {
      holidaySet.add(holiday.date);
    }
    year += 1;
  }

  return holidaySet;
}

function clampDayRange(startDay: string, endDay: string, reportStartDay: string, reportEndDay: string) {
  const clampedStart = startDay < reportStartDay ? reportStartDay : startDay;
  const clampedEnd = endDay > reportEndDay ? reportEndDay : endDay;
  return {
    startDay: clampedStart,
    endDay: clampedEnd < clampedStart ? clampedStart : clampedEnd,
  };
}

function getEntryValue(entry: ReportRow, key: string, customFields: CompanyCustomField[], contractsByUser: Map<number, ContractRow[]>) {
  const customValues = parseJsonRecord(entry.custom_field_values_json);
  if (key.startsWith("custom:")) {
    return customValues[key.slice("custom:".length)] ?? null;
  }

  if (key === "user") return entry.full_name;
  if (key === "role") return normalizeRole(entry.role);
  if (key === "type") return getTypeLabel(entry.entry_type);
  if (key === "date") return entry.entry_date;
  if (key === "start") return entry.entry_type === "work" ? entry.start_time : entry.entry_date;
  if (key === "finish") return entry.entry_type === "work" ? entry.end_time : (entry.end_date ?? entry.entry_date);
  if (key === "duration") return entry.entry_type === "work" ? diffMinutes(entry.start_time ?? "", entry.end_time) : 0;
  if (key === "note") return entry.notes ?? "";
  if (key === "month") return getMonthKey(entry.entry_date);
  if (key === "cost") {
    if (entry.entry_type !== "work") return 0;
    const durationMinutes = diffMinutes(entry.start_time ?? "", entry.end_time);
    const rate = resolveContractRate(contractsByUser.get(entry.user_id) ?? [], entry.entry_date);
    return Math.round((durationMinutes / 60) * rate * 100) / 100;
  }

  return null;
}

function normalizeReportValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value;
}

export const reportService = {
  async generate(databasePath: string, input: ReportRequestInput) {
    if (input.userIds.length === 0) {
      throw new HTTPException(400, { message: "Select at least one user" });
    }
    if (input.columns.length === 0) {
      throw new HTTPException(400, { message: "Select at least one field" });
    }
    if (input.endDate < input.startDate) {
      throw new HTTPException(400, { message: "End date must be on or after start date" });
    }

    const settings = settingsService.getSettings(databasePath);
    const holidaySet = await getHolidaySet(databasePath, settings.country, input.startDate, input.endDate);
    const db = getCompanyDb(databasePath);
    const placeholders = buildInClause(input.userIds);
    const rows = db.prepare(
      `SELECT
        te.id,
        te.user_id,
        u.full_name,
        u.role,
        te.entry_type,
        te.entry_date,
        te.end_date,
        te.start_time,
        te.end_time,
        te.notes,
        te.custom_field_values_json
       FROM time_entries te
       INNER JOIN users u ON u.id = te.user_id
       WHERE te.user_id IN (${placeholders})
         AND te.entry_date <= ?
         AND COALESCE(te.end_date, te.entry_date) >= ?
       ORDER BY u.full_name COLLATE NOCASE ASC, te.entry_date ASC, te.start_time ASC, te.id ASC`
    ).all(...input.userIds, input.endDate, input.startDate) as ReportRow[];

    const contractRows = db.prepare(
      `SELECT
        id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        created_at
       FROM user_contracts
       WHERE user_id IN (${placeholders})
       ORDER BY start_date ASC`
    ).all(...input.userIds) as Array<{
      id: number;
      user_id: number;
      hours_per_week: number;
      start_date: string;
      end_date: string | null;
      payment_per_hour: number;
      created_at: string;
    }>;

    const contractsByUser = new Map<number, ContractRow[]>();
    for (const row of contractRows) {
      const next = contractsByUser.get(row.user_id) ?? [];
      next.push({
        id: row.id,
        userId: row.user_id,
        hoursPerWeek: row.hours_per_week,
        startDate: row.start_date,
        endDate: row.end_date,
        paymentPerHour: row.payment_per_hour,
        createdAt: row.created_at
      });
      contractsByUser.set(row.user_id, next);
    }

    const leaveMetricCache = new Map<number, ReturnType<typeof calculateLeaveCompensation>>();
    const entryValue = (row: ReportRow, key: string) => {
      if ((key === "duration" || key === "cost") && row.entry_type !== "work") {
        let cached = leaveMetricCache.get(row.id);
        if (!cached) {
          const clampedRange = clampDayRange(
            row.entry_date,
            row.end_date ?? row.entry_date,
            input.startDate,
            input.endDate,
          );
          cached = calculateLeaveCompensation(
            row.entry_type,
            clampedRange.startDay,
            clampedRange.endDay,
            holidaySet,
            contractsByUser.get(row.user_id) ?? [],
          );
          leaveMetricCache.set(row.id, cached);
        }

        return key === "duration" ? cached.durationMinutes : cached.costAmount;
      }

      return getEntryValue(row, key, settings.customFields, contractsByUser);
    };

    const validGroupBy = input.groupBy.filter((key, index, array) => key && array.indexOf(key) === index).slice(0, 8);
    const grouped = input.totalsOnly || validGroupBy.length > 0;

    const totals = rows.reduce(
      (current, row) => {
        const durationMinutes = Number(entryValue(row, "duration") ?? 0);
        const cost = Number(entryValue(row, "cost") ?? 0);
        return {
          entryCount: current.entryCount + 1,
          durationMinutes: current.durationMinutes + durationMinutes,
          cost: Math.round((current.cost + cost) * 100) / 100
        };
      },
      { entryCount: 0, durationMinutes: 0, cost: 0 }
    );

    if (!grouped) {
      const columns = input.columns
        .map((key) => getColumnDefinition(key, settings.customFields))
        .filter((value): value is ReportColumnDefinition => value !== null);
      const detailRows = rows.map((row) => {
        const next: Record<string, string | number | null> = {};
        for (const column of columns) {
          next[column.key] = normalizeReportValue(entryValue(row, column.key));
        }
        return next;
      });

      return {
        startDate: input.startDate,
        endDate: input.endDate,
        columns,
        rows: detailRows,
        totals,
        locale: settings.locale,
        dateTimeFormat: settings.dateTimeFormat,
        currency: settings.currency,
        grouped: false
      };
    }

    const bucketMap = new Map<string, {
      groupValues: Record<string, string | number | null>;
      entryCount: number;
      durationMinutes: number;
      cost: number;
    }>();

    const effectiveGroupBy = input.totalsOnly ? [] : validGroupBy;
    for (const row of rows) {
      const groupValues: Record<string, string | number | null> = {};
      for (const key of effectiveGroupBy) {
        groupValues[key] = normalizeReportValue(entryValue(row, key));
      }
      const bucketKey = effectiveGroupBy.length > 0 ? effectiveGroupBy.map((key) => String(groupValues[key] ?? "")).join("||") : "__all__";
      const durationMinutes = Number(entryValue(row, "duration") ?? 0);
      const cost = Number(entryValue(row, "cost") ?? 0);
      const current = bucketMap.get(bucketKey);
      if (current) {
        current.entryCount += 1;
        current.durationMinutes += durationMinutes;
        current.cost = Math.round((current.cost + cost) * 100) / 100;
      } else {
        bucketMap.set(bucketKey, {
          groupValues,
          entryCount: 1,
          durationMinutes,
          cost
        });
      }
    }

    const columnKeys = [
      ...effectiveGroupBy,
      "entries",
      ...(input.columns.includes("duration") ? ["duration"] : []),
      ...(input.columns.includes("cost") ? ["cost"] : [])
    ].filter((key, index, array) => array.indexOf(key) === index);

    const columns = columnKeys
      .map((key) => getColumnDefinition(key, settings.customFields))
      .filter((value): value is ReportColumnDefinition => value !== null);

    const groupedRows = Array.from(bucketMap.values()).map((bucket) => {
      const next: Record<string, string | number | null> = {};
      for (const key of effectiveGroupBy) {
        next[key] = bucket.groupValues[key] ?? null;
      }
      if (columnKeys.includes("entries")) next.entries = bucket.entryCount;
      if (columnKeys.includes("duration")) next.duration = bucket.durationMinutes;
      if (columnKeys.includes("cost")) next.cost = bucket.cost;
      return next;
    });

    return {
      startDate: input.startDate,
      endDate: input.endDate,
      columns,
      rows: groupedRows,
      totals,
      locale: settings.locale,
      dateTimeFormat: settings.dateTimeFormat,
      currency: settings.currency,
      grouped: true
    };
  }
};
