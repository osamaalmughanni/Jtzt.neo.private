import { HTTPException } from "hono/http-exception";
import type { CreateProjectInput, CreateTaskInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapProject, mapTask } from "../db/mappers";

export const taskService = {
  listProjectData(databasePath: string) {
    const db = getCompanyDb(databasePath);
    const projects = db
      .prepare("SELECT id, name, description, is_active, created_at FROM projects WHERE is_active = 1 ORDER BY created_at DESC")
      .all()
      .map(mapProject);
    const tasks = db
      .prepare("SELECT id, project_id, title, is_active, created_at FROM tasks WHERE is_active = 1 ORDER BY created_at DESC")
      .all()
      .map(mapTask);

    return { projects, tasks };
  },

  createProject(databasePath: string, input: CreateProjectInput) {
    const db = getCompanyDb(databasePath);
    db.prepare("INSERT INTO projects (name, description, created_at) VALUES (@name, @description, @createdAt)").run({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      createdAt: new Date().toISOString()
    });
  },

  createTask(databasePath: string, input: CreateTaskInput) {
    const db = getCompanyDb(databasePath);
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId);
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    db.prepare("INSERT INTO tasks (project_id, title, created_at) VALUES (@projectId, @title, @createdAt)").run({
      projectId: input.projectId,
      title: input.title.trim(),
      createdAt: new Date().toISOString()
    });
  }
};
