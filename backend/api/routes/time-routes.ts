import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { timeService } from "../../services/time-service";
import type { AppVariables } from "../context";

const startTimerSchema = z.object({
  notes: z.string().optional(),
  projectId: z.number().nullable().optional()
});

const stopTimerSchema = z.object({
  entryId: z.number().optional(),
  notes: z.string().optional()
});

const updateEntrySchema = z.object({
  entryId: z.number(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  notes: z.string(),
  projectId: z.number().nullable()
});

export const timeRoutes = new Hono<{ Variables: AppVariables }>();

timeRoutes.use("*", authMiddleware, requireCompanyUser);

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
  return c.json({
    entries: timeService.listEntries(session.databasePath, session.userId, {
      from: c.req.query("from"),
      to: c.req.query("to")
    })
  });
});

timeRoutes.put("/entry", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const body = updateEntrySchema.parse(await c.req.json());
  return c.json({
    entry: timeService.updateEntry(session.databasePath, session.userId, body)
  });
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
