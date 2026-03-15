import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { settingsService } from "../../services/settings-service";
import { systemService } from "../../services/system-service";
import type { AppVariables } from "../context";

const updateSettingsSchema = z.object({
  currency: z.string().min(3).max(3),
  locale: z.string().min(2).max(64),
  dateTimeFormat: z.string().min(1).max(32),
  firstDayOfWeek: z.number().int().min(0).max(6),
  editDaysLimit: z.number().int().min(0).max(3650),
  insertDaysLimit: z.number().int().min(0).max(3650),
  allowOneRecordPerDay: z.boolean(),
  allowIntersectingRecords: z.boolean(),
  country: z.string().length(2),
  tabletIdleTimeoutSeconds: z.number().int().min(0).max(86400),
  autoBreakAfterMinutes: z.number().int().min(0).max(1440),
  autoBreakDurationMinutes: z.number().int().min(0).max(1440),
  customFields: z.array(
    z.object({
      id: z.string().min(1).max(100),
      label: z.string().min(1).max(100),
      type: z.enum(["text", "number", "date", "boolean", "select"]),
      targets: z.array(z.enum(["work", "vacation", "sick_leave"])).min(1),
      required: z.boolean(),
      placeholder: z.string().max(120).nullable(),
      options: z.array(
        z.object({
          id: z.string().min(1).max(100),
          label: z.string().min(1).max(100),
          value: z.string().min(1).max(100),
        }),
      ).max(100),
    })
  ).max(100)
});

const holidayQuerySchema = z.object({
  country: z.string().length(2),
  year: z.coerce.number().int().min(2000).max(2100)
});

const tabletCodeSchema = z.object({
  code: z.string().min(6).max(32)
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

settingsRoutes.get("/tablet-code", requireCompanyAdmin, (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const tabletCode = systemService.getTabletCodeStatus(session.companyId);
  if (!tabletCode) {
    return c.json({ error: "Company not found" }, 404);
  }

  return c.json({ tabletCode });
});

settingsRoutes.put("/tablet-code", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = tabletCodeSchema.parse(await c.req.json());
  const response = systemService.setTabletCode(session.companyId, body.code);
  return c.json(response);
});

settingsRoutes.post("/tablet-code/regenerate", requireCompanyAdmin, (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(systemService.regenerateTabletCode(session.companyId));
});
