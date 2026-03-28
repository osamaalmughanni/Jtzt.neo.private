import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, companyDbMiddleware, hasCompanyAdminAccess, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { calculationService } from "../../services/calculation-service";
import type { AppRouteConfig } from "../context";

const chartConfigSchema = z.object({
  type: z.enum(["bar", "line", "area", "pie"]),
  categoryColumn: z.string().trim().min(1).max(100).nullable(),
  valueColumn: z.string().trim().min(1).max(100).nullable(),
  seriesColumn: z.string().trim().min(1).max(100).nullable(),
  stacked: z.boolean(),
});

const createCalculationSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  sqlText: z.string().min(5),
  outputMode: z.enum(["table", "chart", "both"]),
  chartConfig: chartConfigSchema,
});

const updateCalculationSchema = createCalculationSchema.extend({
  calculationId: z.number().int().positive(),
});

const createFromPresetSchema = z.object({
  presetKey: z.string().min(1).max(100),
});

const validateCalculationSchema = z.object({
  sqlText: z.string().min(5),
  chartConfig: chartConfigSchema,
});

const calculationIdSchema = z.object({
  calculationId: z.coerce.number().int().positive(),
});

export const calculationRoutes = new Hono<AppRouteConfig>();

calculationRoutes.use("*", authMiddleware, requireCompanyUser, companyDbMiddleware);

calculationRoutes.get("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json(await calculationService.listCalculations(c.get("db"), session.companyId));
});

calculationRoutes.post("/validate", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = validateCalculationSchema.parse(await c.req.json());
  return c.json(await calculationService.validateSql(c.get("db"), body.sqlText, body.chartConfig));
});

calculationRoutes.post("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createCalculationSchema.parse(await c.req.json());
  const calculationId = await calculationService.createCalculation(c.get("db"), session.companyId, body);
  return c.json({ success: true, calculationId });
});

calculationRoutes.put("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = updateCalculationSchema.parse(await c.req.json());
  await calculationService.updateCalculation(c.get("db"), session.companyId, body);
  return c.json({ success: true });
});

calculationRoutes.delete("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = calculationIdSchema.parse(await c.req.json());
  await calculationService.deleteCalculation(c.get("db"), session.companyId, body.calculationId);
  return c.json({ success: true });
});

calculationRoutes.post("/from-preset", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (!hasCompanyAdminAccess(session)) {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createFromPresetSchema.parse(await c.req.json());
  const calculationId = await calculationService.createFromPreset(c.get("db"), session.companyId, body);
  return c.json({ success: true, calculationId });
});
