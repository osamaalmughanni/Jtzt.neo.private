import { HTTPException } from "hono/http-exception";
import type { CreateProjectInput, CreateTaskInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapProject, mapTask } from "../db/mappers";

export const taskService = {
  listProjectData(companyId: string) {
    const db = getCompanyDb(companyId);
    const projects = db
      .prepare("SELECT id, name, description, is_active, created_at FROM projects WHERE company_id = ? AND is_active = 1 ORDER BY created_at DESC")
      .all(companyId)
      .map(mapProject);
    const tasks = db
      .prepare("SELECT id, project_id, title, is_active, created_at FROM tasks WHERE company_id = ? AND is_active = 1 ORDER BY created_at DESC")
      .all(companyId)
      .map(mapTask);

    return { projects, tasks };
  },

  createProject(companyId: string, input: CreateProjectInput) {
    getCompanyDb(companyId)
      .prepare("INSERT INTO projects (company_id, name, description, created_at) VALUES (@companyId, @name, @description, @createdAt)")
      .run({
        companyId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        createdAt: new Date().toISOString()
      });
  },

  createTask(companyId: string, input: CreateTaskInput) {
    const db = getCompanyDb(companyId);
    const project = db.prepare("SELECT id FROM projects WHERE company_id = ? AND id = ?").get(companyId, input.projectId);
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    db.prepare("INSERT INTO tasks (company_id, project_id, title, created_at) VALUES (@companyId, @projectId, @title, @createdAt)").run({
      companyId,
      projectId: input.projectId,
      title: input.title.trim(),
      createdAt: new Date().toISOString()
    });
  }
};
