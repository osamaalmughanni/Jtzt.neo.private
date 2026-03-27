import { Hono } from "hono";
import { z } from "zod";
import { normalizeTimeZone } from "../../../shared/utils/time";
import { authMiddleware, companyDbMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { companyApiService } from "../../services/company-api-service";
import { settingsService } from "../../services/settings-service";
import { systemService } from "../../services/system-service";
import type { AppRouteConfig } from "../context";

const customFieldTargetSchema = z.union([
  z.object({ scope: z.literal("user") }),
  z.object({ scope: z.literal("project") }),
  z.object({ scope: z.literal("task") }),
  z.object({
    scope: z.literal("time_entry"),
    entryTypes: z.array(z.enum(["work", "vacation", "sick_leave", "time_off_in_lieu"])).min(1),
  }),
]);

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
  allowRecordsOnHolidays: z.boolean(),
  allowFutureRecords: z.boolean(),
  country: z.string().length(2),
  tabletIdleTimeoutSeconds: z.number().int().min(0).max(86400),
  autoBreakAfterMinutes: z.number().int().min(0).max(1440),
  autoBreakDurationMinutes: z.number().int().min(0).max(1440),
  projectsEnabled: z.boolean(),
  tasksEnabled: z.boolean(),
  overtime: z.object({
    version: z.literal(1),
    presetId: z.enum(["at_default", "de_default", "fr_35h", "eu_custom"]),
    countryCode: z.string().length(2).nullable(),
    title: z.string().min(1).max(120),
    dailyOvertimeThresholdHours: z.number().min(0).max(24),
    weeklyOvertimeThresholdHours: z.number().min(0).max(168),
    averagingEnabled: z.boolean(),
    averagingWeeks: z.number().int().min(1).max(52),
    rules: z.array(
      z.object({
        id: z.string().min(1).max(100),
        category: z.enum(["standard_overtime", "sunday_holiday", "night_shift", "special"]),
        triggerKind: z.enum(["daily_overtime", "weekly_overtime", "sunday_or_holiday", "night_shift", "daily_after_hours", "weekly_after_hours"]),
        afterHours: z.number().min(0).max(168).nullable(),
        windowStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
        windowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
        multiplierPercent: z.number().min(0).max(500),
        compensationType: z.enum(["cash", "time_off", "cash_or_time_off"])
      })
    ).max(32),
    payoutDecisionMode: z.enum(["company", "employee", "conditional"]),
    employeeChoiceAfterDailyHours: z.number().min(0).max(24).nullable(),
    employeeChoiceAfterWeeklyHours: z.number().min(0).max(168).nullable(),
    conflictResolution: z.enum(["stack", "highest_only"])
  }),
  customFields: z.array(
    z.object({
      id: z.string().min(1).max(100),
      label: z.string().min(1).max(100),
      type: z.enum(["text", "number", "date", "boolean", "select"]),
      targets: z.array(customFieldTargetSchema).min(1),
      required: z.boolean(),
      placeholder: z.string().max(120).nullable(),
      options: z.array(
        z.object({
          id: z.string().min(1).max(100),
          label: z.string().min(1).max(100),
          value: z.string().max(100).optional(),
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

const overtimeSettingsSchema = z.object({
  overtime: updateSettingsSchema.shape.overtime
});

export const settingsRoutes = new Hono<AppRouteConfig>();

settingsRoutes.use("*", authMiddleware, requireCompanyUser, companyDbMiddleware);

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
  const normalizedBody = {
    ...body,
    customFields: body.customFields.map((field) => ({
      ...field,
      options: field.options.map((option) => ({
        ...option,
        value: option.value?.trim() || option.id,
      })),
      targets: field.targets.map((target) =>
        target.scope === "time_entry"
          ? { scope: "time_entry" as const, entryTypes: Array.from(new Set(target.entryTypes)) }
          : target
      ),
    })),
  };
  return c.json({ settings: await settingsService.updateSettings(c.get("db"), session.companyId, normalizedBody) });
});

settingsRoutes.get("/overtime", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ overtime: await settingsService.getOvertimeSettings(c.get("db"), session.companyId) });
});

settingsRoutes.put("/overtime", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = overtimeSettingsSchema.parse(await c.req.json());
  return c.json({ overtime: await settingsService.updateOvertimeSettings(c.get("db"), session.companyId, body) });
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

  const tabletCode = await systemService.getTabletCodeStatus(c.get("systemDb"), session.companyId);
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
  const response = await systemService.setTabletCode(c.get("systemDb"), session.companyId, body.code);
  return c.json(response);
});

settingsRoutes.post("/tablet-code/regenerate", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(await systemService.regenerateTabletCode(c.get("systemDb"), session.companyId));
});

settingsRoutes.get("/api-access", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ status: await companyApiService.getApiKeyStatus(c.get("systemDb"), session.companyId) });
});

settingsRoutes.post("/api-access/rotate", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(await companyApiService.rotateApiKey(c.get("systemDb"), session.companyId));
});

settingsRoutes.get("/api-access/docs", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ docs: await companyApiService.getGeneratedDocs(c.get("db")) });
});
