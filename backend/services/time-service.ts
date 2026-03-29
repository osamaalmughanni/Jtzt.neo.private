import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import type { CreateManualTimeEntryInput, StartTimerInput, StopTimerInput, UpdateTimeEntryInput } from "../../shared/types/api";
import type { TimeEntryType } from "../../shared/types/models";
import { combineLocalDayAndTimeToIsoInTimeZone, formatLocalDay, getLocalNowSnapshot, parseLocalDay } from "../../shared/utils/time";
import { timeEntries } from "../db/schema";
import { mapTimeEntryView } from "../db/mappers";
import { settingsService } from "./settings-service";
import type { AppDatabase } from "../runtime/types";

function isWorkEntry(entryType: TimeEntryType) {
  return entryType === "work";
}

function resolveNonWorkAnchorIso(day: string, timeZone: string) {
  const anchorIso = combineLocalDayAndTimeToIsoInTimeZone(day, "12:00", timeZone);
  if (!anchorIso) {
    throw new HTTPException(400, { message: "Could not resolve business day anchor" });
  }

  return anchorIso;
}

function normalizeRangeEndDate(startDate: string, endDate?: string | null) {
  return endDate && endDate >= startDate ? endDate : startDate;
}

function buildWorkTimestamps(startDate: string, endDate: string | null | undefined, startTime: string | null, endTime: string | null) {
  if (!startTime || !endTime) {
    throw new HTTPException(400, { message: "Start time and end time are required" });
  }

  const usesExplicitOffset = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  if (!usesExplicitOffset(startTime) || !usesExplicitOffset(endTime)) {
    throw new HTTPException(400, { message: "Time values must include a timezone offset" });
  }

  const startAt = new Date(startTime);
  const endAt = new Date(endTime);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new HTTPException(400, { message: "Invalid time value" });
  }
  if (startAt.getTime() >= endAt.getTime()) {
    throw new HTTPException(400, { message: "End time must be after start time" });
  }

  const resolvedEndDate = normalizeRangeEndDate(startDate, endDate);

  return {
    entryDate: startDate,
    endDate: resolvedEndDate,
    startTime: startAt.toISOString(),
    endTime: endAt.toISOString()
  };
}

function buildNonWorkTimestamps(startDate: string, endDate: string | null | undefined, timeZone: string) {
  const resolvedEndDate = normalizeRangeEndDate(startDate, endDate);
  const startAnchor = resolveNonWorkAnchorIso(startDate, timeZone);
  const endAnchor = resolveNonWorkAnchorIso(resolvedEndDate, timeZone);

  return {
    entryDate: startDate,
    endDate: resolvedEndDate,
    startTime: startAnchor,
    endTime: endAnchor
  };
}

async function normalizeManualEntryInput(db: AppDatabase, companyId: string, input: CreateManualTimeEntryInput | UpdateTimeEntryInput) {
  const entryType = input.entryType;
  if (isWorkEntry(entryType)) {
    return {
      entryType,
      ...buildWorkTimestamps(input.startDate, input.endDate, input.startTime, input.endTime),
      customFieldValues: input.customFieldValues
    };
  }

  return {
    entryType,
    ...buildNonWorkTimestamps(input.startDate, input.endDate, (await settingsService.getSettings(db, companyId)).timeZone),
    customFieldValues: input.customFieldValues
  };
}

async function getOpenEntry(db: AppDatabase, companyId: string, userId: number) {
  return await db.orm.select({
    id: timeEntries.id,
    user_id: timeEntries.userId,
    entry_type: timeEntries.entryType,
    entry_date: timeEntries.entryDate,
    end_date: timeEntries.endDate,
    start_time: timeEntries.startTime,
    end_time: timeEntries.endTime,
    notes: timeEntries.notes,
    project_id: timeEntries.projectId,
    task_id: timeEntries.taskId,
    custom_field_values_json: timeEntries.customFieldValuesJson,
    created_at: timeEntries.createdAt,
  }).from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.entryType, "work"), isNull(timeEntries.endTime)))
    .orderBy(desc(timeEntries.startTime))
    .get() as
    | {
        id: number;
        user_id: number;
        entry_type: TimeEntryType;
        end_time: string | null;
        start_time: string | null;
      }
    | undefined;
}

function toFilterDay(isoValue?: string) {
  return isoValue ? isoValue.slice(0, 10) : null;
}

function rangesOverlap(startDay: string, endDay: string, otherStartDay: string, otherEndDay: string) {
  return startDay <= otherEndDay && otherStartDay <= endDay;
}

function timestampsOverlap(startTime: string | null, endTime: string | null, otherStartTime: string | null, otherEndTime: string | null) {
  const start = startTime ? new Date(startTime).getTime() : Number.NaN;
  const end = endTime ? new Date(endTime).getTime() : Number.POSITIVE_INFINITY;
  const otherStart = otherStartTime ? new Date(otherStartTime).getTime() : Number.NaN;
  const otherEnd = otherEndTime ? new Date(otherEndTime).getTime() : Number.POSITIVE_INFINITY;

  if (Number.isNaN(start) || Number.isNaN(otherStart)) {
    return false;
  }

  return start < otherEnd && otherStart < end;
}

export const timeService = {
  async getActiveEntry(db: AppDatabase, companyId: string, userId: number) {
    const activeEntry = await getOpenEntry(db, companyId, userId);
    return activeEntry ? mapTimeEntryView(activeEntry) : null;
  },

  async createManualEntry(db: AppDatabase, companyId: string, userId: number, input: CreateManualTimeEntryInput) {
    const normalized = await normalizeManualEntryInput(db, companyId, input);
    const createdAt = new Date().toISOString();
    const result = await db.orm.insert(timeEntries).values({
      userId,
      entryType: normalized.entryType,
      entryDate: normalized.entryDate,
      endDate: normalized.endDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      notes: input.notes.trim() || null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      customFieldValuesJson: JSON.stringify(normalized.customFieldValues),
      createdAt
    }).returning({ id: timeEntries.id });

    return this.getEntryById(db, companyId, Number(result[0]?.id));
  },

  async hasEntryOnRange(db: AppDatabase, companyId: string, userId: number, startDay: string, endDay: string, excludeEntryId?: number) {
    const row = await db.orm.select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        excludeEntryId ? ne(timeEntries.id, excludeEntryId) : undefined,
        lte(timeEntries.entryDate, endDay),
        or(gte(timeEntries.endDate, startDay), and(isNull(timeEntries.endDate), gte(timeEntries.entryDate, startDay)))
      ))
      .get();

    return Boolean(row);
  },

  async hasIntersectingEntry(
    db: AppDatabase,
    companyId: string,
    userId: number,
    candidate: {
      entryType: TimeEntryType;
      entryDate: string;
      endDate: string | null;
      startTime: string | null;
      endTime: string | null;
    },
    excludeEntryId?: number
  ) {
    const rows = await db.orm.select({
      id: timeEntries.id,
      entry_type: timeEntries.entryType,
      entry_date: timeEntries.entryDate,
      end_date: timeEntries.endDate,
      start_time: timeEntries.startTime,
      end_time: timeEntries.endTime,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        excludeEntryId ? ne(timeEntries.id, excludeEntryId) : undefined,
        lte(timeEntries.entryDate, candidate.endDate ?? candidate.entryDate),
        or(gte(timeEntries.endDate, candidate.entryDate), and(isNull(timeEntries.endDate), gte(timeEntries.entryDate, candidate.entryDate)))
      ))
      .orderBy(timeEntries.entryDate, timeEntries.startTime) as Array<{
        id: number;
        entry_type: TimeEntryType;
        entry_date: string;
        end_date: string | null;
        start_time: string | null;
        end_time: string | null;
      }>;

    const candidateEndDay = candidate.endDate ?? candidate.entryDate;
    return rows.some((row) => {
      const rowEndDay = row.end_date ?? row.entry_date;
      if (!rangesOverlap(candidate.entryDate, candidateEndDay, row.entry_date, rowEndDay)) {
        return false;
      }

      if (candidate.entryType !== "work" || row.entry_type !== "work") {
        return true;
      }

      return timestampsOverlap(candidate.startTime, candidate.endTime, row.start_time, row.end_time);
    });
  },

  async hasWorkEntryOnRange(
    db: AppDatabase,
    companyId: string,
    userId: number,
    startDay: string,
    endDay: string,
    excludeEntryId?: number,
  ) {
    const row = await db.orm.select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.entryType, "work"),
        excludeEntryId ? ne(timeEntries.id, excludeEntryId) : undefined,
        lte(timeEntries.entryDate, endDay),
        or(gte(timeEntries.endDate, startDay), and(isNull(timeEntries.endDate), gte(timeEntries.entryDate, startDay)))
      ))
      .get();

    return Boolean(row);
  },

  async hasNonWorkEntryOnRange(
    db: AppDatabase,
    companyId: string,
    userId: number,
    startDay: string,
    endDay: string,
    excludeEntryId?: number,
  ) {
    const row = await db.orm.select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        ne(timeEntries.entryType, "work"),
        excludeEntryId ? ne(timeEntries.id, excludeEntryId) : undefined,
        lte(timeEntries.entryDate, endDay),
        or(gte(timeEntries.endDate, startDay), and(isNull(timeEntries.endDate), gte(timeEntries.entryDate, startDay)))
      ))
      .get();

    return Boolean(row);
  },

  async startTimer(db: AppDatabase, companyId: string, userId: number, input: StartTimerInput, snapshot = getLocalNowSnapshot()) {
    const openEntry = await getOpenEntry(db, companyId, userId);
    if (openEntry) {
      throw new HTTPException(400, { message: "A timer is already running" });
    }

    const result = await db.orm.insert(timeEntries).values({
      userId,
      entryType: "work",
      entryDate: snapshot.localDay,
      endDate: snapshot.localDay,
      startTime: snapshot.instantIso,
      endTime: null,
      notes: input.notes?.trim() || null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
      createdAt: snapshot.instantIso
    }).returning({ id: timeEntries.id });

    return this.getEntryById(db, companyId, Number(result[0]?.id));
  },

  async stopTimer(db: AppDatabase, companyId: string, userId: number, input: StopTimerInput) {
    const target = (
      input.entryId
        ? await db.orm.select({
            id: timeEntries.id,
            user_id: timeEntries.userId,
            entry_date: timeEntries.entryDate,
            end_time: timeEntries.endTime,
            entry_type: timeEntries.entryType,
            notes: timeEntries.notes,
          }).from(timeEntries).where(eq(timeEntries.id, input.entryId)).get()
        : await getOpenEntry(db, companyId, userId)
    ) as { id: number; user_id: number; entry_date: string; end_time: string | null; entry_type: TimeEntryType; notes?: string | null } | undefined;

    if (!target || target.user_id !== userId || target.entry_type !== "work" || target.end_time) {
      throw new HTTPException(404, { message: "Open time entry not found" });
    }

    const stoppedAt = new Date();
    const snapshot = await settingsService.getBusinessNowSnapshot(db, companyId, stoppedAt);
    const resolvedEndDate = snapshot.localDay;

    await db.orm.update(timeEntries).set({
      endTime: stoppedAt.toISOString(),
      endDate: resolvedEndDate,
      notes: (input.notes?.trim() || target.notes) ?? null,
    }).where(eq(timeEntries.id, target.id)).run();

    return this.getEntryById(db, companyId, target.id);
  },

  async updateEntry(db: AppDatabase, companyId: string, userId: number, input: UpdateTimeEntryInput) {
    const existing = await db.orm.select({
      id: timeEntries.id,
      user_id: timeEntries.userId,
    }).from(timeEntries).where(eq(timeEntries.id, input.entryId)).get() as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    const normalized = await normalizeManualEntryInput(db, companyId, input);
    await db.orm.update(timeEntries).set({
      userId,
      entryType: normalized.entryType,
      entryDate: normalized.entryDate,
      endDate: normalized.endDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      notes: input.notes.trim(),
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      customFieldValuesJson: JSON.stringify(normalized.customFieldValues),
    }).where(eq(timeEntries.id, input.entryId)).run();

    return this.getEntryById(db, companyId, input.entryId);
  },

  async deleteEntry(db: AppDatabase, companyId: string, userId: number, entryId: number) {
    const existing = await db.orm.select({
      id: timeEntries.id,
      user_id: timeEntries.userId,
    }).from(timeEntries).where(eq(timeEntries.id, entryId)).get() as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    await db.orm.delete(timeEntries).where(eq(timeEntries.id, entryId)).run();
  },

  async listEntries(db: AppDatabase, companyId: string, userId: number, filters: { from?: string; to?: string }) {
    const fromDay = toFilterDay(filters.from);
    const toDay = toFilterDay(filters.to);
    const rows = await db.orm.select({
      id: timeEntries.id,
      user_id: timeEntries.userId,
      entry_type: timeEntries.entryType,
      entry_date: timeEntries.entryDate,
      end_date: timeEntries.endDate,
      start_time: timeEntries.startTime,
      end_time: timeEntries.endTime,
      notes: timeEntries.notes,
      project_id: timeEntries.projectId,
      task_id: timeEntries.taskId,
      custom_field_values_json: timeEntries.customFieldValuesJson,
      created_at: timeEntries.createdAt,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        fromDay
          ? or(gte(timeEntries.endDate, fromDay), and(isNull(timeEntries.endDate), gte(timeEntries.entryDate, fromDay)))
          : undefined,
        toDay ? lte(timeEntries.entryDate, toDay) : undefined
      ))
      .orderBy(desc(timeEntries.entryDate), desc(timeEntries.startTime), desc(timeEntries.id));

    return rows.map(mapTimeEntryView);
  },

  async getDashboard(db: AppDatabase, companyId: string, userId: number) {
    const todayDay = (await settingsService.getBusinessNowSnapshot(db, companyId)).localDay;
    const weekStart = parseLocalDay(todayDay) ?? new Date();
    const weekday = weekStart.getDay();
    const offset = weekday === 0 ? -6 : 1 - weekday;
    weekStart.setDate(weekStart.getDate() + offset);
    const weekEntries = await this.listEntries(db, companyId, userId, { from: formatLocalDay(weekStart) });
    const todayEntries = await this.listEntries(db, companyId, userId, { from: todayDay, to: todayDay });
    const activeEntry = await this.getActiveEntry(db, companyId, userId);

    return {
      todayMinutes: todayEntries
        .filter((entry: (typeof todayEntries)[number]) => entry.entryType === "work")
        .reduce((sum: number, entry: (typeof todayEntries)[number]) => sum + entry.durationMinutes, 0),
      weekMinutes: weekEntries
        .filter((entry: (typeof weekEntries)[number]) => entry.entryType === "work")
        .reduce((sum: number, entry: (typeof weekEntries)[number]) => sum + entry.durationMinutes, 0),
      activeEntry,
      recentEntries: (await this.listEntries(db, companyId, userId, {})).slice(0, 5)
    };
  },

  async getEntryById(db: AppDatabase, companyId: string, entryId: number) {
    const row = await db.orm.select({
      id: timeEntries.id,
      user_id: timeEntries.userId,
      entry_type: timeEntries.entryType,
      entry_date: timeEntries.entryDate,
      end_date: timeEntries.endDate,
      start_time: timeEntries.startTime,
      end_time: timeEntries.endTime,
      notes: timeEntries.notes,
      project_id: timeEntries.projectId,
      task_id: timeEntries.taskId,
      custom_field_values_json: timeEntries.customFieldValuesJson,
      created_at: timeEntries.createdAt,
    }).from(timeEntries).where(eq(timeEntries.id, entryId)).get();

    if (!row) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    return mapTimeEntryView(row);
  }
};
