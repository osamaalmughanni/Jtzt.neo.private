import { Hono } from "hono";
import { z } from "zod";
import { normalizeTimeZone } from "../../../shared/utils/time";
import { authMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { companyApiService } from "../../services/company-api-service";
import { settingsService } from "../../services/settings-service";
import { systemService } from "../../services/system-service";
import type { AppRouteConfig } from "../context";

const updateSettingsSchema = z.object({
  currency: z.string().min(3).max(3),
  locale: z.string().min(2).max(64),
  timeZone: z.string().min(1).max(100).refine((value) => normalizeTimeZone(value) !== null, "Invalid time zone"),
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
  code: z.string().min(1).max(64)
});

export const settingsRoutes = new Hono<AppRouteConfig>();

settingsRoutes.use("*", authMiddleware, requireCompanyUser);

settingsRoutes.get("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ settings: await settingsService.getSettings(c.get("db"), session.companyId) });
});

settingsRoutes.put("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = updateSettingsSchema.parse(await c.req.json());
  return c.json({ settings: await settingsService.updateSettings(c.get("db"), session.companyId, body) });
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

  return c.json(await settingsService.getPublicHolidays(c.get("db"), session.companyId, query.country, query.year));
});

settingsRoutes.get("/tablet-code", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const tabletCode = await systemService.getTabletCodeStatus(c.get("db"), session.companyId);
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
  const response = await systemService.setTabletCode(c.get("db"), session.companyId, body.code);
  return c.json(response);
});

settingsRoutes.post("/tablet-code/regenerate", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(await systemService.regenerateTabletCode(c.get("db"), session.companyId));
});

settingsRoutes.get("/api-access", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ status: await companyApiService.getApiKeyStatus(c.get("db"), session.companyId) });
});

settingsRoutes.post("/api-access/rotate", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(await companyApiService.rotateApiKey(c.get("db"), session.companyId));
});

settingsRoutes.get("/api-access/docs", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ docs: await companyApiService.getGeneratedDocs(c.get("db")) });
});
