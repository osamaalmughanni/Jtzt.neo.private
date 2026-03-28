import { HTTPException } from "hono/http-exception";
import type { CreateManualTimeEntryInput, StartTimerInput, StopTimerInput, UpdateTimeEntryInput } from "../../shared/types/api";
import type { TimeEntryType } from "../../shared/types/models";
import { combineLocalDayAndTimeToIsoInTimeZone, formatLocalDay, getLocalNowSnapshot, parseLocalDay } from "../../shared/utils/time";
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
  return await db.first(
    `SELECT te.*
     FROM time_entries te
     WHERE te.user_id = ? AND te.entry_type = 'work' AND te.end_time IS NULL
     ORDER BY te.start_time DESC LIMIT 1`,
    [userId]
  ) as
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
    const result = await db.run(
      `INSERT INTO time_entries (
          user_id,
          entry_type,
          entry_date,
          end_date,
          start_time,
          end_time,
          notes,
          project_id,
          task_id,
          custom_field_values_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        normalized.entryType,
        normalized.entryDate,
        normalized.endDate,
        normalized.startTime,
        normalized.endTime,
        input.notes.trim() || null,
        input.projectId ?? null,
        input.taskId ?? null,
        JSON.stringify(normalized.customFieldValues),
        createdAt
      ]
    );

    return this.getEntryById(db, companyId, Number(result.lastRowId));
  },

  async hasEntryOnRange(db: AppDatabase, companyId: string, userId: number, startDay: string, endDay: string, excludeEntryId?: number) {
    const row = await db.first(
      `SELECT id
         FROM time_entries
         WHERE user_id = ?
           AND (? IS NULL OR id != ?)
           AND entry_date <= ?
           AND COALESCE(end_date, entry_date) >= ?
         LIMIT 1`,
      [userId, excludeEntryId ?? null, excludeEntryId ?? null, endDay, startDay]
    );

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
    const rows = await db.all(
      `SELECT id, entry_type, entry_date, end_date, start_time, end_time
         FROM time_entries
         WHERE user_id = ?
           AND (? IS NULL OR id != ?)
           AND entry_date <= ?
           AND COALESCE(end_date, entry_date) >= ?
         ORDER BY entry_date ASC, start_time ASC`,
      [userId, excludeEntryId ?? null, excludeEntryId ?? null, candidate.endDate ?? candidate.entryDate, candidate.entryDate]
    ) as Array<{ id: number; entry_type: TimeEntryType; entry_date: string; end_date: string | null; start_time: string | null; end_time: string | null }>;

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
    const row = await db.first(
      `SELECT id
         FROM time_entries
         WHERE user_id = ?
           AND entry_type = 'work'
           AND (? IS NULL OR id != ?)
           AND entry_date <= ?
           AND COALESCE(end_date, entry_date) >= ?
         LIMIT 1`,
      [userId, excludeEntryId ?? null, excludeEntryId ?? null, endDay, startDay]
    );

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
    const row = await db.first(
      `SELECT id
         FROM time_entries
         WHERE user_id = ?
           AND entry_type != 'work'
           AND (? IS NULL OR id != ?)
           AND entry_date <= ?
           AND COALESCE(end_date, entry_date) >= ?
         LIMIT 1`,
      [userId, excludeEntryId ?? null, excludeEntryId ?? null, endDay, startDay]
    );

    return Boolean(row);
  },

  async startTimer(db: AppDatabase, companyId: string, userId: number, input: StartTimerInput, snapshot = getLocalNowSnapshot()) {
    const openEntry = await getOpenEntry(db, companyId, userId);
    if (openEntry) {
      throw new HTTPException(400, { message: "A timer is already running" });
    }

    const result = await db.run(
      `INSERT INTO time_entries (
          user_id,
          entry_type,
          entry_date,
          end_date,
          start_time,
          end_time,
          notes,
          project_id,
          task_id,
          custom_field_values_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        "work",
        snapshot.localDay,
        snapshot.localDay,
        snapshot.instantIso,
        null,
        input.notes?.trim() || null,
        input.projectId ?? null,
        input.taskId ?? null,
        JSON.stringify(input.customFieldValues ?? {}),
        snapshot.instantIso
      ]
    );

    return this.getEntryById(db, companyId, Number(result.lastRowId));
  },

  async stopTimer(db: AppDatabase, companyId: string, userId: number, input: StopTimerInput) {
    const target = (
      input.entryId
        ? await db.first("SELECT id, user_id, entry_date, end_time, entry_type FROM time_entries WHERE id = ?", [input.entryId])
        : await getOpenEntry(db, companyId, userId)
    ) as { id: number; user_id: number; entry_date: string; end_time: string | null; entry_type: TimeEntryType } | undefined;

    if (!target || target.user_id !== userId || target.entry_type !== "work" || target.end_time) {
      throw new HTTPException(404, { message: "Open time entry not found" });
    }

    const stoppedAt = new Date();
    const snapshot = await settingsService.getBusinessNowSnapshot(db, companyId, stoppedAt);
    const resolvedEndDate = snapshot.localDay;

    await db.run(
      "UPDATE time_entries SET end_time = ?, end_date = ?, notes = COALESCE(?, notes) WHERE id = ?",
      [stoppedAt.toISOString(), resolvedEndDate, input.notes?.trim() || null, target.id]
    );

    return this.getEntryById(db, companyId, target.id);
  },

  async updateEntry(db: AppDatabase, companyId: string, userId: number, input: UpdateTimeEntryInput) {
    const existing = await db.first("SELECT id, user_id FROM time_entries WHERE id = ?", [input.entryId]) as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    const normalized = await normalizeManualEntryInput(db, companyId, input);
    await db.run(
      `UPDATE time_entries
       SET
         user_id = ?,
         entry_type = ?,
         entry_date = ?,
        end_date = ?,
        start_time = ?,
        end_time = ?,
        notes = ?,
        project_id = ?,
        task_id = ?,
        custom_field_values_json = ?
      WHERE id = ?`,
      [
        userId,
        normalized.entryType,
        normalized.entryDate,
        normalized.endDate,
        normalized.startTime,
        normalized.endTime,
        input.notes.trim(),
        input.projectId ?? null,
        input.taskId ?? null,
        JSON.stringify(normalized.customFieldValues),
        input.entryId
      ]
    );

    return this.getEntryById(db, companyId, input.entryId);
  },

  async deleteEntry(db: AppDatabase, companyId: string, userId: number, entryId: number) {
    const existing = await db.first("SELECT id, user_id FROM time_entries WHERE id = ?", [entryId]) as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    await db.run("DELETE FROM time_entries WHERE id = ?", [entryId]);
  },

  async listEntries(db: AppDatabase, companyId: string, userId: number, filters: { from?: string; to?: string }) {
    const fromDay = toFilterDay(filters.from);
    const toDay = toFilterDay(filters.to);
    const rows = await db.all(
      `SELECT te.*
         FROM time_entries te
         WHERE te.user_id = ?
           AND (? IS NULL OR COALESCE(te.end_date, te.entry_date) >= ?)
           AND (? IS NULL OR te.entry_date <= ?)
         ORDER BY te.entry_date DESC, te.start_time DESC, te.id DESC`,
      [userId, fromDay, fromDay, toDay, toDay]
    );

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
      todayMinutes: todayEntries.filter((entry) => entry.entryType === "work").reduce((sum, entry) => sum + entry.durationMinutes, 0),
      weekMinutes: weekEntries.filter((entry) => entry.entryType === "work").reduce((sum, entry) => sum + entry.durationMinutes, 0),
      activeEntry,
      recentEntries: (await this.listEntries(db, companyId, userId, {})).slice(0, 5)
    };
  },

  async getEntryById(db: AppDatabase, companyId: string, entryId: number) {
    const row = await db.first("SELECT te.* FROM time_entries te WHERE te.id = ?", [entryId]);

    if (!row) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    return mapTimeEntryView(row);
  }
};
