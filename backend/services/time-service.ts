import { HTTPException } from "hono/http-exception";
import type { StartTimerInput, StopTimerInput, UpdateTimeEntryInput } from "../../shared/types/api";
import { startOfDayIso, startOfWeekIso } from "../../shared/utils/time";
import { getCompanyDb } from "../db/company-db";
import { mapTimeEntryView } from "../db/mappers";

function getOpenEntry(db: ReturnType<typeof getCompanyDb>, userId: number) {
  return db
    .prepare(
      "SELECT te.*, p.name as project_name FROM time_entries te LEFT JOIN projects p ON p.id = te.project_id WHERE te.user_id = ? AND te.end_time IS NULL ORDER BY te.start_time DESC LIMIT 1"
    )
    .get(userId);
}

export const timeService = {
  startTimer(databasePath: string, userId: number, input: StartTimerInput) {
    const db = getCompanyDb(databasePath);
    const openEntry = getOpenEntry(db, userId);
    if (openEntry) {
      throw new HTTPException(400, { message: "A timer is already running" });
    }

    const createdAt = new Date().toISOString();
    const result = db
      .prepare(
        "INSERT INTO time_entries (user_id, project_id, start_time, notes, created_at) VALUES (@userId, @projectId, @startTime, @notes, @createdAt)"
      )
      .run({
        userId,
        projectId: input.projectId ?? null,
        startTime: createdAt,
        notes: input.notes?.trim() || null,
        createdAt
      });

    return this.getEntryById(databasePath, Number(result.lastInsertRowid));
  },

  stopTimer(databasePath: string, userId: number, input: StopTimerInput) {
    const db = getCompanyDb(databasePath);
    const target = input.entryId
      ? db.prepare("SELECT id, user_id, end_time FROM time_entries WHERE id = ?").get(input.entryId)
      : getOpenEntry(db, userId);

    if (!target || target.user_id !== userId || target.end_time) {
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

    db.prepare(
      "UPDATE time_entries SET start_time = @startTime, end_time = @endTime, notes = @notes, project_id = @projectId WHERE id = @id"
    ).run({
      id: input.entryId,
      startTime: input.startTime,
      endTime: input.endTime,
      notes: input.notes.trim(),
      projectId: input.projectId
    });

    return this.getEntryById(databasePath, input.entryId);
  },

  listEntries(databasePath: string, userId: number, filters: { from?: string; to?: string }) {
    const rows = getCompanyDb(databasePath)
      .prepare(
        `SELECT te.*, p.name as project_name
         FROM time_entries te
         LEFT JOIN projects p ON p.id = te.project_id
         WHERE te.user_id = @userId
           AND (@from IS NULL OR te.start_time >= @from)
           AND (@to IS NULL OR te.start_time <= @to)
         ORDER BY te.start_time DESC`
      )
      .all({
        userId,
        from: filters.from ?? null,
        to: filters.to ?? null
      });

    return rows.map(mapTimeEntryView);
  },

  getDashboard(databasePath: string, userId: number) {
    const db = getCompanyDb(databasePath);
    const todayEntries = this.listEntries(databasePath, userId, { from: startOfDayIso() });
    const weekEntries = this.listEntries(databasePath, userId, { from: startOfWeekIso() });
    const activeEntry = getOpenEntry(db, userId);

    return {
      todayMinutes: todayEntries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
      weekMinutes: weekEntries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
      activeEntry: activeEntry ? mapTimeEntryView(activeEntry) : null,
      recentEntries: this.listEntries(databasePath, userId, {}).slice(0, 5)
    };
  },

  getEntryById(databasePath: string, entryId: number) {
    const row = getCompanyDb(databasePath)
      .prepare(
        "SELECT te.*, p.name as project_name FROM time_entries te LEFT JOIN projects p ON p.id = te.project_id WHERE te.id = ?"
      )
      .get(entryId);

    if (!row) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }

    return mapTimeEntryView(row);
  }
};
