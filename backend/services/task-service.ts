import { HTTPException } from "hono/http-exception";
import type { CreateProjectInput, CreateTaskInput } from "../../shared/types/api";
import { mapProject, mapTask } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

export const taskService = {
  async listProjectData(db: AppDatabase, companyId: string) {
    const projects = (await db.all(
      "SELECT id, name, description, is_active, created_at FROM projects WHERE company_id = ? AND is_active = 1 ORDER BY created_at DESC",
      [companyId]
    )).map(mapProject);
    const tasks = (await db.all(
      "SELECT id, project_id, title, is_active, created_at FROM tasks WHERE company_id = ? AND is_active = 1 ORDER BY created_at DESC",
      [companyId]
    )).map(mapTask);

    return { projects, tasks };
  },

  async createProject(db: AppDatabase, companyId: string, input: CreateProjectInput) {
    await db.run("INSERT INTO projects (company_id, name, description, created_at) VALUES (?, ?, ?, ?)", [
      companyId,
      input.name.trim(),
      input.description?.trim() || null,
      new Date().toISOString()
    ]);
  },

  async createTask(db: AppDatabase, companyId: string, input: CreateTaskInput) {
    const project = await db.first("SELECT id FROM projects WHERE company_id = ? AND id = ?", [companyId, input.projectId]);
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    await db.run("INSERT INTO tasks (company_id, project_id, title, created_at) VALUES (?, ?, ?, ?)", [
      companyId,
      input.projectId,
      input.title.trim(),
      new Date().toISOString()
    ]);
  }
};
