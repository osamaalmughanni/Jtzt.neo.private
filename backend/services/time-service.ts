import { HTTPException } from "hono/http-exception";
import type { CreateManualTimeEntryInput, StartTimerInput, StopTimerInput, UpdateTimeEntryInput } from "../../shared/types/api";
import type { TimeEntryType } from "../../shared/types/models";
import { startOfDayIso, startOfWeekIso } from "../../shared/utils/time";
import { getCompanyDb } from "../db/company-db";
import { mapTimeEntryView } from "../db/mappers";

function isWorkEntry(entryType: TimeEntryType) {
  return entryType === "work";
}

function usesDateRange(entryType: TimeEntryType) {
  return entryType === "vacation" || entryType === "sick_leave";
}

function toDayStartIso(day: string) {
  return `${day}T00:00:00`;
}

function normalizeRangeEndDate(startDate: string, endDate?: string | null) {
  return endDate && endDate >= startDate ? endDate : startDate;
}

function buildWorkTimestamps(startDate: string, startTime: string | null, endTime: string | null) {
  if (!startTime || !endTime) {
    throw new HTTPException(400, { message: "Start time and end time are required" });
  }

  const startAt = new Date(startTime);
  const endAt = new Date(endTime);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new HTTPException(400, { message: "Invalid time value" });
  }
  if (startAt.getTime() >= endAt.getTime()) {
    throw new HTTPException(400, { message: "End time must be after start time" });
  }

  return {
    entryDate: startDate,
    endDate: null,
    startTime,
    endTime
  };
}

function buildNonWorkTimestamps(entryType: TimeEntryType, startDate: string, endDate?: string | null) {
  const resolvedEndDate = usesDateRange(entryType) ? normalizeRangeEndDate(startDate, endDate) : null;
  const anchorDate = toDayStartIso(startDate);

  return {
    entryDate: startDate,
    endDate: resolvedEndDate,
    startTime: anchorDate,
    endTime: anchorDate
  };
}

function normalizeManualEntryInput(input: CreateManualTimeEntryInput | UpdateTimeEntryInput) {
  const entryType = input.entryType;
  if (isWorkEntry(entryType)) {
    return {
      entryType,
      ...buildWorkTimestamps(input.startDate, input.startTime, input.endTime),
      customFieldValues: input.customFieldValues
    };
  }

  return {
    entryType,
    ...buildNonWorkTimestamps(entryType, input.startDate, input.endDate),
    customFieldValues: input.customFieldValues
  };
}

function getOpenEntry(db: ReturnType<typeof getCompanyDb>, userId: number) {
  return db
    .prepare(
      `SELECT te.*
       FROM time_entries te
       WHERE te.user_id = ? AND te.entry_type = 'work' AND te.end_time IS NULL
       ORDER BY te.start_time DESC LIMIT 1`
    )
    .get(userId) as
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

export const timeService = {
  createManualEntry(databasePath: string, userId: number, input: CreateManualTimeEntryInput) {
    const normalized = normalizeManualEntryInput(input);
    const createdAt = new Date().toISOString();
    const result = getCompanyDb(databasePath)
      .prepare(
        `INSERT INTO time_entries (
          user_id,
          entry_type,
          entry_date,
          end_date,
          start_time,
          end_time,
          notes,
          sick_leave_attachment_name,
          sick_leave_attachment_mime_type,
          sick_leave_attachment_data_url,
          custom_field_values_json,
          created_at
        ) VALUES (
          @userId,
          @entryType,
          @entryDate,
          @endDate,
          @startTime,
          @endTime,
          @notes,
          @sickLeaveAttachmentName,
          @sickLeaveAttachmentMimeType,
          @sickLeaveAttachmentDataUrl,
          @customFieldValuesJson,
          @createdAt
        )`
      )
      .run({
        userId,
        entryType: normalized.entryType,
        entryDate: normalized.entryDate,
        endDate: normalized.endDate,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        notes: input.notes.trim() || null,
        sickLeaveAttachmentName: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.fileName ?? null : null,
        sickLeaveAttachmentMimeType: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.mimeType ?? null : null,
        sickLeaveAttachmentDataUrl: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.dataUrl ?? null : null,
        customFieldValuesJson: JSON.stringify(normalized.customFieldValues),
        createdAt
      });

    return this.getEntryById(databasePath, Number(result.lastInsertRowid));
  },

  startTimer(databasePath: string, userId: number, input: StartTimerInput) {
    const db = getCompanyDb(databasePath);
    const openEntry = getOpenEntry(db, userId);
    if (openEntry) {
      throw new HTTPException(400, { message: "A timer is already running" });
    }

    const createdAt = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO time_entries (
          user_id,
          entry_type,
          entry_date,
          start_time,
          notes,
          created_at
        ) VALUES (
          @userId,
          'work',
          @entryDate,
          @startTime,
          @notes,
          @createdAt
        )`
      )
      .run({
        userId,
        entryDate: createdAt.slice(0, 10),
        startTime: createdAt,
        notes: input.notes?.trim() || null,
        createdAt
      });

    return this.getEntryById(databasePath, Number(result.lastInsertRowid));
  },

  stopTimer(databasePath: string, userId: number, input: StopTimerInput) {
    const db = getCompanyDb(databasePath);
    const target = (
      input.entryId
        ? db.prepare("SELECT id, user_id, end_time, entry_type FROM time_entries WHERE id = ?").get(input.entryId)
        : getOpenEntry(db, userId)
    ) as { id: number; user_id: number; end_time: string | null; entry_type: TimeEntryType } | undefined;

    if (!target || target.user_id !== userId || target.entry_type !== "work" || target.end_time) {
      throw new HTTPException(404, { message: "Open time entry not found" });
    }

    db.prepare("UPDATE time_entries SET end_time = @endTime, notes = COALESCE(@notes, notes) WHERE id = @id").run({
      id: target.id,
      endTime: new Date().toISOString(),
      notes: input.notes?.trim() || null
    });

    return this.getEntryById(databasePath, target.id);
  },

  updateEntry(databasePath: string, userId: number, input: UpdateTimeEntryInput) {
    const db = getCompanyDb(databasePath);
    const existing = db.prepare("SELECT id, user_id FROM time_entries WHERE id = ?").get(input.entryId) as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    const normalized = normalizeManualEntryInput(input);

    db.prepare(
      `UPDATE time_entries
       SET
         entry_type = @entryType,
         entry_date = @entryDate,
         end_date = @endDate,
         start_time = @startTime,
         end_time = @endTime,
         notes = @notes,
         sick_leave_attachment_name = @sickLeaveAttachmentName,
         sick_leave_attachment_mime_type = @sickLeaveAttachmentMimeType,
         sick_leave_attachment_data_url = @sickLeaveAttachmentDataUrl,
         custom_field_values_json = @customFieldValuesJson
       WHERE id = @id`
    ).run({
      id: input.entryId,
      entryType: normalized.entryType,
      entryDate: normalized.entryDate,
      endDate: normalized.endDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      notes: input.notes.trim(),
      sickLeaveAttachmentName: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.fileName ?? null : null,
      sickLeaveAttachmentMimeType: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.mimeType ?? null : null,
      sickLeaveAttachmentDataUrl: input.entryType === "sick_leave" ? input.sickLeaveAttachment?.dataUrl ?? null : null,
      customFieldValuesJson: JSON.stringify(normalized.customFieldValues)
    });

    return this.getEntryById(databasePath, input.entryId);
  },

  deleteEntry(databasePath: string, userId: number, entryId: number) {
    const db = getCompanyDb(databasePath);
    const existing = db.prepare("SELECT id, user_id FROM time_entries WHERE id = ?").get(entryId) as
      | { id: number; user_id: number }
      | undefined;

    if (!existing || existing.user_id !== userId) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    db.prepare("DELETE FROM time_entries WHERE id = ?").run(entryId);
  },

  listEntries(databasePath: string, userId: number, filters: { from?: string; to?: string }) {
    const fromDay = toFilterDay(filters.from);
    const toDay = toFilterDay(filters.to);
    const rows = getCompanyDb(databasePath)
      .prepare(
        `SELECT te.*
         FROM time_entries te
         WHERE te.user_id = @userId
           AND (@fromDay IS NULL OR COALESCE(te.end_date, te.entry_date) >= @fromDay)
           AND (@toDay IS NULL OR te.entry_date <= @toDay)
         ORDER BY te.entry_date DESC, te.start_time DESC, te.id DESC`
      )
      .all({
        userId,
        fromDay,
        toDay
      });

    return rows.map(mapTimeEntryView);
  },

  getDashboard(databasePath: string, userId: number) {
    const db = getCompanyDb(databasePath);
    const todayEntries = this.listEntries(databasePath, userId, { from: startOfDayIso(), to: startOfDayIso() });
    const weekEntries = this.listEntries(databasePath, userId, { from: startOfWeekIso() });
    const activeEntry = getOpenEntry(db, userId);

    return {
      todayMinutes: todayEntries.filter((entry) => entry.entryType === "work").reduce((sum, entry) => sum + entry.durationMinutes, 0),
      weekMinutes: weekEntries.filter((entry) => entry.entryType === "work").reduce((sum, entry) => sum + entry.durationMinutes, 0),
      activeEntry: activeEntry ? mapTimeEntryView(activeEntry) : null,
      recentEntries: this.listEntries(databasePath, userId, {}).slice(0, 5)
    };
  },

  getEntryById(databasePath: string, entryId: number) {
    const row = getCompanyDb(databasePath)
      .prepare(
        `SELECT te.*
         FROM time_entries te
         WHERE te.id = ?`
      )
      .get(entryId);

    if (!row) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    return mapTimeEntryView(row);
  }
};
