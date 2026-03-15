import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { settingsService } from "../../services/settings-service";
import type { AppVariables } from "../context";

const updateSettingsSchema = z.object({
  trackingMode: z.enum(["time", "project", "project_and_tasks"]),
  recordType: z.enum(["all", "start_finish", "duration"]),
  currency: z.string().min(3).max(3),
  locale: z.string().min(2).max(64),
  firstDayOfWeek: z.number().int().min(0).max(6),
  editDaysLimit: z.number().int().min(0).max(3650),
  insertDaysLimit: z.number().int().min(0).max(3650),
  country: z.string().length(2)
});

const holidayQuerySchema = z.object({
  country: z.string().length(2),
  year: z.coerce.number().int().min(2000).max(2100)
});

export const settingsRoutes = new Hono<{ Variables: AppVariables }>();

settingsRoutes.use("*", authMiddleware, requireCompanyUser);

settingsRoutes.get("/", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ settings: settingsService.getSettings(session.databasePath) });
});

settingsRoutes.put("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = updateSettingsSchema.parse(await c.req.json());
  return c.json({ settings: settingsService.updateSettings(session.databasePath, body) });
});

settingsRoutes.get("/holidays", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const query = holidayQuerySchema.parse({
    country: c.req.query("country"),
    year: c.req.query("year")
  });

  return c.json(await settingsService.getPublicHolidays(session.databasePath, query.country, query.year));
});
