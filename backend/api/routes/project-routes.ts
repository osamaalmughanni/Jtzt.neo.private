import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyAdmin, requireCompanyUser } from "../../auth/middleware";
import { projectService } from "../../services/project-service";
import { taskService } from "../../services/task-service";
import type { AppVariables } from "../context";

const createProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional()
});

const createTaskSchema = z.object({
  projectId: z.number(),
  title: z.string().min(2)
});

export const projectRoutes = new Hono<{ Variables: AppVariables }>();

projectRoutes.use("*", authMiddleware, requireCompanyUser);

projectRoutes.get("/", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  return c.json(projectService.listProjects(session.databasePath));
});

projectRoutes.post("/", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createProjectSchema.parse(await c.req.json());
  taskService.createProject(session.databasePath, body);
  return c.json({ success: true });
});

projectRoutes.post("/tasks", requireCompanyAdmin, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createTaskSchema.parse(await c.req.json());
  taskService.createTask(session.databasePath, body);
  return c.json({ success: true });
});
