import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, companyDbMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { settingsService } from "../../services/settings-service";
import { taskService } from "../../services/task-service";
import { validateCustomFieldValuesForTarget } from "../../../shared/utils/custom-fields";
import type { AppRouteConfig } from "../context";

const customFieldValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).default({});

const activeOnlyQuerySchema = z.object({
  activeOnly: z.coerce.boolean().optional()
});

const createProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  budget: z.number().nonnegative(),
  isActive: z.boolean().optional(),
  allowAllUsers: z.boolean(),
  allowAllTasks: z.boolean(),
  userIds: z.array(z.number().int().positive()).optional(),
  taskIds: z.array(z.number().int().positive()).optional(),
  customFieldValues: customFieldValuesSchema,
});

const updateProjectSchema = createProjectSchema.extend({
  projectId: z.number().int().positive(),
  description: z.string().nullable().optional(),
  isActive: z.boolean(),
  userIds: z.array(z.number().int().positive()),
  taskIds: z.array(z.number().int().positive()),
  customFieldValues: customFieldValuesSchema,
});

const deleteProjectSchema = z.object({
  projectId: z.number().int().positive()
});

const createTaskSchema = z.object({
  title: z.string().min(2)
});

const updateTaskSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().min(2),
  isActive: z.boolean()
});

const deleteTaskSchema = z.object({
  taskId: z.number().int().positive()
});

export const projectRoutes = new Hono<AppRouteConfig>();

projectRoutes.use("*", authMiddleware, requireCompanyUser, companyDbMiddleware);

projectRoutes.get("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const query = activeOnlyQuerySchema.parse(c.req.query());
  return c.json(await taskService.listProjectData(c.get("db"), session.companyId, { activeOnly: query.activeOnly }));
});

projectRoutes.post("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createProjectSchema.parse(await c.req.json());
  const settings = await settingsService.getSettings(c.get("db"), session.companyId);
  const customFieldValues = validateCustomFieldValuesForTarget(settings.customFields, { scope: "project" }, body.customFieldValues);
  await taskService.createProject(c.get("db"), session.companyId, { ...body, customFieldValues });
  return c.json({ success: true });
});

projectRoutes.put("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = updateProjectSchema.parse(await c.req.json());
  const settings = await settingsService.getSettings(c.get("db"), session.companyId);
  const customFieldValues = validateCustomFieldValuesForTarget(settings.customFields, { scope: "project" }, body.customFieldValues);
  await taskService.updateProject(c.get("db"), session.companyId, { ...body, customFieldValues });
  return c.json({ success: true });
});

projectRoutes.delete("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = deleteProjectSchema.parse(await c.req.json());
  await taskService.deleteProject(c.get("db"), session.companyId, body);
  return c.json({ success: true });
});

projectRoutes.post("/tasks", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createTaskSchema.extend({ customFieldValues: customFieldValuesSchema }).parse(await c.req.json());
  const settings = await settingsService.getSettings(c.get("db"), session.companyId);
  const customFieldValues = validateCustomFieldValuesForTarget(settings.customFields, { scope: "task" }, body.customFieldValues);
  await taskService.createTask(c.get("db"), session.companyId, { ...body, customFieldValues });
  return c.json({ success: true });
});

projectRoutes.put("/tasks/item", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = updateTaskSchema.extend({ customFieldValues: customFieldValuesSchema }).parse(await c.req.json());
  const settings = await settingsService.getSettings(c.get("db"), session.companyId);
  const customFieldValues = validateCustomFieldValuesForTarget(settings.customFields, { scope: "task" }, body.customFieldValues);
  await taskService.updateTask(c.get("db"), session.companyId, { ...body, customFieldValues });
  return c.json({ success: true });
});

projectRoutes.delete("/tasks/item", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = deleteTaskSchema.parse(await c.req.json());
  await taskService.deleteTask(c.get("db"), session.companyId, body);
  return c.json({ success: true });
});
