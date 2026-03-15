import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { timeService } from "../../services/time-service";
import { settingsService } from "../../services/settings-service";
import type { AppVariables } from "../context";

const startTimerSchema = z.object({
  notes: z.string().optional(),
  projectId: z.number().nullable().optional()
});

const stopTimerSchema = z.object({
  entryId: z.number().optional(),
  notes: z.string().optional()
});

const attachmentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    dataUrl: z.string().startsWith("data:").max(10_000_000)
  })
  .nullable();

const updateEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  projectId: z.number().nullable(),
  taskId: z.number().nullable(),
  sickLeaveAttachment: attachmentSchema
});

const createManualEntrySchema = z.object({
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  projectId: z.number().nullable(),
  taskId: z.number().nullable(),
  sickLeaveAttachment: attachmentSchema
});

const deleteEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional()
});

export const timeRoutes = new Hono<{ Variables: AppVariables }>();

timeRoutes.use("*", authMiddleware, requireCompanyUser);

function resolveTargetUserId(session: AppVariables["session"], requestedUserId?: number) {
  if (!requestedUserId || requestedUserId === session.userId) {
    return session.userId;
  }

  if (session.role !== "admin" && session.role !== "manager") {
    throw new Error("Manager access required");
  }

  return requestedUserId;
}

timeRoutes.post("/start", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const body = startTimerSchema.parse(await c.req.json());
  return c.json({
    entry: timeService.startTimer(session.databasePath, session.userId, body)
  });
});

timeRoutes.post("/entry", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createManualEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  const settings = settingsService.getSettings(session.databasePath);

  if (body.entryType !== "work" && body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }

  if (body.entryType === "work" && settings.trackingMode === "project" && body.projectId === null) {
    return c.json({ error: "Project is required" }, 400);
  }

  if (
    body.entryType === "work" &&
    settings.trackingMode === "project_and_tasks" &&
    (body.projectId === null || body.taskId === null)
  ) {
    return c.json({ error: "Project and task are required" }, 400);
  }

  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }

  const rangeHoliday = await settingsService.findPublicHolidayInRange(
    session.databasePath,
    body.startDate,
    body.endDate ?? body.startDate
  );
  if (rangeHoliday) {
    return c.json({ error: `Records are not allowed on public holidays like ${rangeHoliday.localName} (${rangeHoliday.date})` }, 400);
  }

  return c.json({
    entry: timeService.createManualEntry(session.databasePath, targetUserId, body)
  });
});

timeRoutes.post("/stop", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const body = stopTimerSchema.parse(await c.req.json());
  return c.json({
    entry: timeService.stopTimer(session.databasePath, session.userId, body)
  });
});

timeRoutes.get("/list", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  return c.json({
    entries: timeService.listEntries(session.databasePath, targetUserId, {
      from: c.req.query("from"),
      to: c.req.query("to")
    })
  });
});

timeRoutes.get("/entry/:entryId", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  const entryId = Number(c.req.param("entryId"));
  const entry = timeService.getEntryById(session.databasePath, entryId);
  if (entry.userId !== targetUserId) {
    return c.json({ error: "Time entry not found" }, 404);
  }
  return c.json({ entry });
});

timeRoutes.put("/entry", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const body = updateEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  if (body.entryType !== "work" && body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }
  const rangeHoliday = await settingsService.findPublicHolidayInRange(
    session.databasePath,
    body.startDate,
    body.endDate ?? body.startDate
  );
  if (rangeHoliday) {
    return c.json({ error: `Records are not allowed on public holidays like ${rangeHoliday.localName} (${rangeHoliday.date})` }, 400);
  }
  return c.json({
    entry: timeService.updateEntry(session.databasePath, targetUserId, body)
  });
});

timeRoutes.delete("/entry", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const body = deleteEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  timeService.deleteEntry(session.databasePath, targetUserId, body.entryId);
  return c.json({ success: true });
});

timeRoutes.get("/dashboard", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  return c.json({
    summary: timeService.getDashboard(session.databasePath, session.userId)
  });
});
