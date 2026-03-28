import { HTTPException } from "hono/http-exception";
import type {
  CreateProjectInput,
  CreateTaskInput,
  DeleteProjectInput,
  DeleteTaskInput,
  UpdateProjectInput,
  UpdateTaskInput
} from "../../shared/types/api";
import { mapProject, mapProjectTaskAssignment, mapProjectUserAssignment, mapTask } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

function normalizeText(value: string | undefined | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function ensureProjectExists(db: AppDatabase, companyId: string, projectId: number) {
  const project = await db.first("SELECT id FROM projects WHERE id = ?", [projectId]);
  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}

async function ensureTaskExists(db: AppDatabase, companyId: string, taskId: number) {
  const task = await db.first("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }
}

export const taskService = {
  async listProjectData(db: AppDatabase, companyId: string, options?: { activeOnly?: boolean }) {
    const projectFilter = options?.activeOnly ? "AND is_active = 1" : "";
    const taskFilter = options?.activeOnly ? "AND is_active = 1" : "";
    const projects = (await db.all(
      `SELECT id, name, description, budget, is_active, allow_all_users, allow_all_tasks, custom_field_values_json, created_at
       FROM projects
       WHERE 1=1 ${projectFilter}
       ORDER BY projects.name COLLATE NOCASE ASC, projects.created_at DESC`,
      []
    )).map(mapProject);
    const tasks = (await db.all(
      `SELECT id, title, is_active, custom_field_values_json, created_at
       FROM tasks
       WHERE 1=1 ${taskFilter}
       ORDER BY tasks.title COLLATE NOCASE ASC, tasks.created_at DESC`,
      []
    )).map(mapTask);
    const users = (await db.all<{ id: number; full_name: string; is_active: number; role: string }>(
      `SELECT id, full_name, is_active, role
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY full_name COLLATE NOCASE ASC`,
      []
    )).map((row) => ({ id: row.id, fullName: row.full_name, isActive: Boolean(row.is_active), role: row.role }));
    const projectUsers = (await db.all(
      `SELECT pu.project_id, pu.user_id, pu.created_at
       FROM project_users pu
       INNER JOIN projects p ON p.id = pu.project_id
       WHERE 1=1
       ORDER BY pu.project_id ASC, pu.user_id ASC, pu.created_at ASC`,
      []
    )).map(mapProjectUserAssignment);
    const projectTasks = (await db.all(
      `SELECT pt.project_id, pt.task_id, pt.created_at
       FROM project_tasks pt
       INNER JOIN projects p ON p.id = pt.project_id
       WHERE 1=1
       ORDER BY pt.project_id ASC, pt.task_id ASC, pt.created_at ASC`,
      []
    )).map(mapProjectTaskAssignment);

    return {
      users,
      projects,
      tasks,
      projectUsers,
      projectTasks
    };
  },

  async createProject(db: AppDatabase, companyId: string, input: CreateProjectInput) {
    const createdAt = new Date().toISOString();
    const selectedUserIds = Array.from(new Set(input.userIds ?? []));
    const selectedTaskIds = Array.from(new Set(input.taskIds ?? []));
    const allowAllUsers = Boolean(input.allowAllUsers) && selectedUserIds.length === 0;
    const allowAllTasks = Boolean(input.allowAllTasks) && selectedTaskIds.length === 0;
    const nextUserIds = allowAllUsers ? [] : selectedUserIds;
    const nextTaskIds = allowAllTasks ? [] : selectedTaskIds;
    if (!allowAllUsers && nextUserIds.length === 0) {
      throw new HTTPException(400, { message: "Select at least one user or enable all users" });
    }
    if (!allowAllTasks && nextTaskIds.length === 0) {
      throw new HTTPException(400, { message: "Select at least one task or enable all tasks" });
    }
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      const result = await db.run(
        "INSERT INTO projects (name, description, budget, is_active, allow_all_users, allow_all_tasks, custom_field_values_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
        input.name.trim(),
        normalizeText(input.description),
        Number(input.budget ?? 0),
        input.isActive === false ? 0 : 1,
        allowAllUsers ? 1 : 0,
        allowAllTasks ? 1 : 0,
        JSON.stringify(input.customFieldValues ?? {}),
        createdAt
        ]
      );
      const projectId = Number(result.lastRowId);
      for (const userId of nextUserIds) {
        const user = await db.first("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", [userId]);
        if (!user) {
          continue;
        }
        await db.run("INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)", [projectId, userId, createdAt]);
      }
      for (const taskId of nextTaskIds) {
        const task = await db.first("SELECT id FROM tasks WHERE id = ?", [taskId]);
        if (!task) {
          continue;
        }
        await db.run("INSERT INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)", [projectId, taskId, createdAt]);
      }
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async updateProject(db: AppDatabase, companyId: string, input: UpdateProjectInput) {
    await ensureProjectExists(db, companyId, input.projectId);
    const selectedUserIds = Array.from(new Set(input.userIds));
    const selectedTaskIds = Array.from(new Set(input.taskIds));
    const allowAllUsers = Boolean(input.allowAllUsers) && selectedUserIds.length === 0;
    const allowAllTasks = Boolean(input.allowAllTasks) && selectedTaskIds.length === 0;
    const nextUserIds = allowAllUsers ? [] : selectedUserIds;
    const nextTaskIds = allowAllTasks ? [] : selectedTaskIds;
    if (!allowAllUsers && nextUserIds.length === 0) {
      throw new HTTPException(400, { message: "Select at least one user or enable all users" });
    }
    if (!allowAllTasks && nextTaskIds.length === 0) {
      throw new HTTPException(400, { message: "Select at least one task or enable all tasks" });
    }
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run(
        `UPDATE projects
         SET name = ?, description = ?, budget = ?, is_active = ?, allow_all_users = ?, allow_all_tasks = ?, custom_field_values_json = ?
         WHERE id = ?`,
        [
          input.name.trim(),
          normalizeText(input.description),
          Number(input.budget ?? 0),
          input.isActive ? 1 : 0,
          allowAllUsers ? 1 : 0,
          allowAllTasks ? 1 : 0,
          JSON.stringify(input.customFieldValues ?? {}),
          input.projectId
        ]
      );
      await db.run("DELETE FROM project_users WHERE project_id = ?", [input.projectId]);
      await db.run("DELETE FROM project_tasks WHERE project_id = ?", [input.projectId]);
      for (const userId of nextUserIds) {
        const user = await db.first("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", [userId]);
        if (user) {
          await db.run("INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)", [input.projectId, userId, new Date().toISOString()]);
        }
      }
      for (const taskId of nextTaskIds) {
        const task = await db.first("SELECT id FROM tasks WHERE id = ?", [taskId]);
        if (task) {
          await db.run("INSERT INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)", [input.projectId, taskId, new Date().toISOString()]);
        }
      }
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async deleteProject(db: AppDatabase, companyId: string, input: DeleteProjectInput) {
    await ensureProjectExists(db, companyId, input.projectId);
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run("DELETE FROM project_tasks WHERE project_id = ?", [input.projectId]);
      await db.run("DELETE FROM project_users WHERE project_id = ?", [input.projectId]);
      await db.run("DELETE FROM projects WHERE id = ?", [input.projectId]);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async createTask(db: AppDatabase, companyId: string, input: CreateTaskInput) {
    await db.run("INSERT INTO tasks (title, custom_field_values_json, created_at) VALUES (?, ?, ?)", [
      input.title.trim(),
      JSON.stringify(input.customFieldValues ?? {}),
      new Date().toISOString()
    ]);
  },

  async updateTask(db: AppDatabase, companyId: string, input: UpdateTaskInput) {
    await ensureTaskExists(db, companyId, input.taskId);
    await db.run(
      `UPDATE tasks
       SET title = ?, is_active = ?, custom_field_values_json = ?
       WHERE id = ?`,
      [
        input.title.trim(),
        input.isActive ? 1 : 0,
        JSON.stringify(input.customFieldValues ?? {}),
        input.taskId
      ]
    );
  },

  async deleteTask(db: AppDatabase, companyId: string, input: DeleteTaskInput) {
    await ensureTaskExists(db, companyId, input.taskId);
    await db.run("DELETE FROM tasks WHERE id = ?", [input.taskId]);
  },

  async setProjectUsers(db: AppDatabase, companyId: string, projectId: number, userIds: number[]) {
    await ensureProjectExists(db, companyId, projectId);
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run("DELETE FROM project_users WHERE project_id = ?", [projectId]);
      for (const userId of Array.from(new Set(userIds))) {
        const user = await db.first("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", [userId]);
        if (!user) {
          continue;
        }
        await db.run("INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)", [projectId, userId, new Date().toISOString()]);
      }
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },

  async setProjectTasks(db: AppDatabase, companyId: string, projectId: number, taskIds: number[]) {
    await ensureProjectExists(db, companyId, projectId);
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run("DELETE FROM project_tasks WHERE project_id = ?", [projectId]);
      for (const taskId of Array.from(new Set(taskIds))) {
        const task = await db.first("SELECT id FROM tasks WHERE id = ?", [taskId]);
        if (!task) {
          continue;
        }
        await db.run("INSERT INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)", [projectId, taskId, new Date().toISOString()]);
      }
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
};
