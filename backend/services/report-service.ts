import { HTTPException } from "hono/http-exception";
import type { ReportColumnDefinition, ReportRequestInput, ReportRowMeta } from "../../shared/types/api";
import type { CompanyCustomField, TimeEntryType, UserContract } from "../../shared/types/models";
import { diffCalendarDays, enumerateLocalDays } from "../../shared/utils/time";
import {
  buildCustomFieldCanonicalKey,
  buildCustomFieldValueLabelLookup,
  getCustomFieldsForTarget,
  getCustomFieldLabel,
  resolveCustomFieldValueLabel,
} from "../../shared/utils/custom-fields";
import { calculateLeaveCompensation, calculateWorkCostAmount, calculateWorkDurationMinutes } from "./time-entry-metrics-service";
import { aggregateOvertimeMeta, buildOvertimeReportMeta } from "./overtime-report-service";
import { settingsService } from "./settings-service";
import { vacationBalanceService } from "./vacation-balance-service";
import type { AppDatabase } from "../runtime/types";
import { mapUserContractScheduleBlock } from "../db/mappers";
import { buildUserContract } from "./user-contract-schedule";

type ReportRow = {
  id: number;
  user_id: number;
  full_name: string;
  role: string;
  project_name: string | null;
  task_title: string | null;
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
  project: { key: "project", label: "Project", kind: "text" },
  task: { key: "task", label: "Task", kind: "text" },
  type: { key: "type", label: "Type", kind: "text" },
  date: { key: "date", label: "Date", kind: "date" },
  start: { key: "start", label: "Start", kind: "datetime" },
  finish: { key: "finish", label: "Finish", kind: "datetime" },
  duration: { key: "duration", label: "Duration", kind: "duration" },
  note: { key: "note", label: "Note", kind: "text" },
  cost: { key: "cost", label: "Cost", kind: "currency" },
  entries: { key: "entries", label: "Entries", kind: "number" },
  month: { key: "month", label: "Month", kind: "text" },
  overtime_state: { key: "overtime_state", label: "Overtime State", kind: "overtime_state" },
  overtime_timeline: { key: "overtime_timeline", label: "Overtime Timeline", kind: "overtime_timeline" }
};

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function getCustomFieldKeyMatches(field: CompanyCustomField, key: string) {
  const normalizedKey = normalizeLookupValue(key);
  return normalizedKey === normalizeLookupValue(buildCustomFieldCanonicalKey(field.id))
    || normalizedKey === normalizeLookupValue(field.id)
    || normalizedKey === normalizeLookupValue(`field-${field.id}`)
    || normalizedKey === normalizeLookupValue(getCustomFieldLabel(field));
}

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
  if (entryType === "time_off_in_lieu") return "Time off in lieu";
  return "Sick leave";
}

function getMonthKey(day: string) {
  return day.slice(0, 7);
}

function getColumnDefinition(key: string, customFields: CompanyCustomField[]): ReportColumnDefinition | null {
  if (key.startsWith("custom:") || key.startsWith("field-") || customFields.some((item) => getCustomFieldKeyMatches(item, key))) {
    const field = customFields.find((item) => getCustomFieldKeyMatches(item, key));
    if (!field) return null;
    return {
      key: buildCustomFieldCanonicalKey(field.id),
      label: getCustomFieldLabel(field),
      kind: field.type === "date" ? "date" : field.type === "number" ? "number" : "text"
    };
  }

  return baseColumns[key] ?? null;
}

async function getHolidaySet(db: AppDatabase, companyId: string, country: string, startDate: string, endDate: string) {
  const holidaySet = new Set<string>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));
  while (year <= finalYear) {
    const response = await settingsService.getPublicHolidays(db, companyId, country, year);
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
    endDay: clampedEnd < clampedStart ? clampedStart : clampedEnd
  };
}

function getVacationDurationDays(startDate: string, endDate: string) {
  return diffCalendarDays(endDate, startDate) + 1;
}

function getMonthKeyLabel(day: string, locale: string) {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return day;
  }
  return new Intl.DateTimeFormat(locale || "en-GB", { month: "short", year: "numeric" }).format(parsed);
}

async function buildVacationOverview(
  db: AppDatabase,
  companyId: string,
  rows: ReportRow[],
  locale: string,
  referenceDay: string,
) {
  const grouped = new Map<number, {
    userId: number;
    userName: string;
    role: string;
    periods: Array<{
      entryId: number;
      startDate: string;
      endDate: string;
      notes: string | null;
      days: number;
    }>;
    monthTotals: Map<string, number>;
  }>();

  for (const row of rows) {
    if (row.entry_type !== "vacation") {
      continue;
    }

    const current = grouped.get(row.user_id) ?? {
      userId: row.user_id,
      userName: row.full_name,
      role: normalizeRole(row.role),
      periods: [],
      monthTotals: new Map<string, number>(),
    };
    const endDate = row.end_date ?? row.entry_date;
    const days = getVacationDurationDays(row.entry_date, endDate);
    current.periods.push({
      entryId: row.id,
      startDate: row.entry_date,
      endDate,
      notes: row.notes ?? null,
      days,
    });

    for (const day of enumerateLocalDays(row.entry_date, endDate)) {
      const monthKey = getMonthKeyLabel(day, locale);
      current.monthTotals.set(monthKey, (current.monthTotals.get(monthKey) ?? 0) + 1);
    }

    grouped.set(row.user_id, current);
  }

  const users = Array.from(grouped.values());
  return Promise.all(users.map(async (user) => {
    const balance = await vacationBalanceService.getReportOverview(db, companyId, user.userId, referenceDay);
    return {
      userId: user.userId,
      userName: user.userName,
      role: user.role,
      entitledDays: balance.entitledDays,
      usedDays: balance.usedDays,
      availableDays: balance.availableDays,
      currentContractVacationDays: balance.currentContractVacationDays,
      currentWorkYearStart: balance.currentWorkYearStart,
      currentWorkYearEnd: balance.currentWorkYearEnd,
      nextFullEntitlementDate: balance.nextFullEntitlementDate,
      inInitialAccrualPhase: balance.inInitialAccrualPhase,
      periods: user.periods.sort((left, right) => left.startDate.localeCompare(right.startDate)),
      monthBreakdown: Array.from(user.monthTotals.entries())
        .map(([label, days]) => ({ label, days }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    };
  })).then((rows) =>
    rows.sort((left, right) => right.availableDays - left.availableDays || left.userName.localeCompare(right.userName))
  );
}

function getEntryValue(
  entry: ReportRow,
  key: string,
  customFields: CompanyCustomField[],
  customFieldValueLabels: Map<string, string>,
) {
  const customValues = parseJsonRecord(entry.custom_field_values_json);
  if (key.startsWith("custom:") || key.startsWith("field-") || customFields.some((item) => getCustomFieldKeyMatches(item, key))) {
    const field = customFields.find((item) => getCustomFieldKeyMatches(item, key));
    const valueKey = field?.id ?? (key.startsWith("custom:") ? key.slice("custom:".length) : key);
    return resolveCustomFieldValueLabel(field, customValues[valueKey] ?? null, customFieldValueLabels);
  }

  if (key === "user") return entry.full_name;
  if (key === "role") return normalizeRole(entry.role);
  if (key === "project") return entry.project_name ?? "";
  if (key === "task") return entry.task_title ?? "";
  if (key === "type") return getTypeLabel(entry.entry_type);
  if (key === "date") return entry.entry_date;
  if (key === "start") return entry.entry_type === "work" ? entry.start_time : entry.entry_date;
  if (key === "finish") return entry.entry_type === "work" ? entry.end_time : entry.end_date ?? entry.entry_date;
  if (key === "duration") return 0;
  if (key === "note") return entry.notes ?? "";
  if (key === "month") return getMonthKey(entry.entry_date);
  if (key === "cost") return 0;
  if (key === "overtime_state" || key === "overtime_timeline") return null;
  return null;
}

function normalizeReportValue(value: string | number | boolean | null) {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : value;
}

export const reportService = {
  async generate(db: AppDatabase, companyId: string, input: ReportRequestInput) {
    if (input.userIds.length === 0) throw new HTTPException(400, { message: "Select at least one user" });
    if (input.columns.length === 0) throw new HTTPException(400, { message: "Select at least one field" });
    if (input.endDate < input.startDate) throw new HTTPException(400, { message: "End date must be on or after start date" });

    const settings = await settingsService.getSettings(db, companyId);
    const customFieldValueLabels = buildCustomFieldValueLabelLookup(settings.customFields);
    const timeEntryCustomFields = getCustomFieldsForTarget(settings.customFields, { scope: "time_entry" });
    const holidaySet = await getHolidaySet(db, companyId, settings.country, input.startDate, input.endDate);
    const placeholders = buildInClause(input.userIds);
    const rows = await db.all(
      `SELECT
        te.id,
        te.user_id,
        u.full_name,
        u.role,
        p.name AS project_name,
        t.title AS task_title,
        te.entry_type,
        te.entry_date,
        te.end_date,
        te.start_time,
        te.end_time,
        te.notes,
        te.custom_field_values_json
       FROM time_entries te
       INNER JOIN users u ON u.id = te.user_id AND u.deleted_at IS NULL AND u.is_active = 1
       LEFT JOIN projects p ON p.id = te.project_id
       LEFT JOIN tasks t ON t.id = te.task_id
       WHERE 1=1
         AND te.user_id IN (${placeholders})
         AND te.entry_date <= ?
         AND COALESCE(te.end_date, te.entry_date) >= ?
       ORDER BY u.full_name COLLATE NOCASE ASC, te.entry_date ASC, te.start_time ASC, te.id ASC`
    , [...input.userIds, input.endDate, input.startDate]) as ReportRow[];

    const contractRows = await db.all(
      `SELECT
        id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        annual_vacation_days,
        created_at
       FROM user_contracts
       WHERE 1=1
         AND user_id IN (${placeholders})
       ORDER BY start_date ASC`
    , [...input.userIds]) as Array<{
      id: number;
      user_id: number;
      hours_per_week: number;
      start_date: string;
      end_date: string | null;
      payment_per_hour: number;
      annual_vacation_days: number;
      created_at: string;
    }>;
    const contractScheduleRows = contractRows.length === 0
      ? []
      : await db.all(
          `SELECT
            contract_id,
            weekday,
            block_order,
            start_time,
            end_time,
            minutes
           FROM user_contract_schedule_blocks
           WHERE contract_id IN (${contractRows.map(() => "?").join(", ")})
           ORDER BY contract_id ASC, weekday ASC, block_order ASC`,
          contractRows.map((row) => row.id)
        ) as Array<{
          contract_id: number;
          weekday: number;
          block_order: number;
          start_time: string | null;
          end_time: string | null;
          minutes: number;
        }>;

    const contractsByUser = new Map<number, ContractRow[]>();
    const scheduleByContract = new Map<number, ReturnType<typeof mapUserContractScheduleBlock>[]>();
    for (const row of contractScheduleRows) {
      const next = scheduleByContract.get(row.contract_id) ?? [];
      next.push(mapUserContractScheduleBlock(row));
      scheduleByContract.set(row.contract_id, next);
    }
    for (const row of contractRows) {
      const next = contractsByUser.get(row.user_id) ?? [];
      next.push(buildUserContract(row, scheduleByContract.get(row.id) ?? []));
      contractsByUser.set(row.user_id, next);
    }

    const leaveMetricCache = new Map<number, ReturnType<typeof calculateLeaveCompensation>>();
    const overtimeMetaByEntryId = buildOvertimeReportMeta(rows, settings, contractsByUser);
    const entryValue = (row: ReportRow, key: string) => {
      if ((key === "duration" || key === "cost") && row.entry_type !== "work") {
        let cached = leaveMetricCache.get(row.id);
        if (!cached) {
          const clampedRange = clampDayRange(row.entry_date, row.end_date ?? row.entry_date, input.startDate, input.endDate);
          cached = calculateLeaveCompensation(
            row.entry_type,
            clampedRange.startDay,
            clampedRange.endDay,
            holidaySet,
            contractsByUser.get(row.user_id) ?? [],
            settings.weekendDays
          );
          leaveMetricCache.set(row.id, cached);
        }
        return key === "duration" ? cached.durationMinutes : cached.costAmount;
      }

      if (key === "duration" && row.entry_type === "work") {
        return calculateWorkDurationMinutes(row.start_time, row.end_time, settings);
      }
      if (key === "cost" && row.entry_type === "work") {
        return calculateWorkCostAmount(row.start_time, row.end_time, row.entry_date, settings, contractsByUser.get(row.user_id) ?? []);
      }

      return getEntryValue(row, key, timeEntryCustomFields, customFieldValueLabels);
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

    const vacationOverview = await buildVacationOverview(db, companyId, rows, settings.locale, input.endDate);

    if (!grouped) {
      const columns = input.columns.map((key) => getColumnDefinition(key, timeEntryCustomFields)).filter((value): value is ReportColumnDefinition => value !== null);
      const detailRows = rows.map((row) => {
        const next: Record<string, string | number | null> = {};
        for (const column of columns) {
          const overtimeMeta = overtimeMetaByEntryId.get(row.id) ?? null;
          if (column.key === "overtime_state") {
            next[column.key] = overtimeMeta?.stateLabel ?? (row.entry_type === "work" ? "Normal" : null);
            continue;
          }
          if (column.key === "overtime_timeline") {
            next[column.key] = overtimeMeta?.summary ?? null;
            continue;
          }
          next[column.key] = normalizeReportValue(entryValue(row, column.key));
        }
        return next;
      });
      const rowMeta: ReportRowMeta[] = rows.map((row) => ({
        entryId: row.id,
        userId: row.user_id,
        overtime: overtimeMetaByEntryId.get(row.id) ?? null
      }));

      return {
        startDate: input.startDate,
        endDate: input.endDate,
        columns,
        rows: detailRows,
        rowMeta,
        totals,
        locale: settings.locale,
        timeZone: settings.timeZone,
        dateTimeFormat: settings.dateTimeFormat,
        currency: settings.currency,
        grouped: false,
        timeline: rows.map((row) => ({
          entryId: row.id,
          userId: row.user_id,
          userName: row.full_name,
          role: normalizeRole(row.role),
          entryType: row.entry_type,
          startDate: row.entry_date,
          endDate: row.end_date ?? row.entry_date,
          startTime: row.start_time,
          endTime: row.end_time,
          notes: row.notes ?? null
        })),
        vacationOverview,
      };
    }

    const bucketMap = new Map<string, { groupValues: Record<string, string | number | null>; entryCount: number; durationMinutes: number; cost: number; rowIds: number[]; userIds: number[] }>();
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
        current.rowIds.push(row.id);
        current.userIds.push(row.user_id);
      } else {
        bucketMap.set(bucketKey, { groupValues, entryCount: 1, durationMinutes, cost, rowIds: [row.id], userIds: [row.user_id] });
      }
    }

    const overtimeColumnKeys = input.columns.filter((key) => key === "overtime_state" || key === "overtime_timeline");
    const columnKeys = [...effectiveGroupBy, "entries", ...(input.columns.includes("duration") ? ["duration"] : []), ...(input.columns.includes("cost") ? ["cost"] : []), ...overtimeColumnKeys].filter(
      (key, index, array) => array.indexOf(key) === index
    );
    const columns = columnKeys.map((key) => getColumnDefinition(key, timeEntryCustomFields)).filter((value): value is ReportColumnDefinition => value !== null);
    const groupedRowMeta: ReportRowMeta[] = [];
    const groupedRows = Array.from(bucketMap.values()).map((bucket) => {
      const overtimeMeta = aggregateOvertimeMeta(bucket.rowIds.map((id) => overtimeMetaByEntryId.get(id)).filter((value): value is NonNullable<typeof value> => value !== undefined));
      const next: Record<string, string | number | null> = {};
      for (const key of effectiveGroupBy) {
        next[key] = bucket.groupValues[key] ?? null;
      }
      if (columnKeys.includes("entries")) next.entries = bucket.entryCount;
      if (columnKeys.includes("duration")) next.duration = bucket.durationMinutes;
      if (columnKeys.includes("cost")) next.cost = bucket.cost;
      if (columnKeys.includes("overtime_state")) next.overtime_state = overtimeMeta?.stateLabel ?? null;
      if (columnKeys.includes("overtime_timeline")) next.overtime_timeline = overtimeMeta?.summary ?? null;
      groupedRowMeta.push({
        entryId: null,
        userId: bucket.userIds.length === 1 ? bucket.userIds[0] : null,
        overtime: overtimeMeta
      });
      return next;
    });

    return {
      startDate: input.startDate,
      endDate: input.endDate,
      columns,
      rows: groupedRows,
      rowMeta: groupedRowMeta,
      totals,
      locale: settings.locale,
      timeZone: settings.timeZone,
      dateTimeFormat: settings.dateTimeFormat,
      currency: settings.currency,
      grouped: true,
      timeline: rows.map((row) => ({
        entryId: row.id,
        userId: row.user_id,
        userName: row.full_name,
        role: normalizeRole(row.role),
        entryType: row.entry_type,
        startDate: row.entry_date,
        endDate: row.end_date ?? row.entry_date,
        startTime: row.start_time,
        endTime: row.end_time,
        notes: row.notes ?? null
      })),
      vacationOverview,
    };
  }
};
