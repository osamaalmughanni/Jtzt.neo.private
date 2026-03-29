import { HTTPException } from "hono/http-exception";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type {
  CreateProjectInput,
  CreateTaskInput,
  DeleteProjectInput,
  DeleteTaskInput,
  UpdateProjectInput,
  UpdateTaskInput
} from "../../shared/types/api";
import { projectTasks, projectUsers, projects, tasks, users } from "../db/schema";
import { mapProject, mapProjectTaskAssignment, mapProjectUserAssignment, mapTask } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

function normalizeText(value: string | undefined | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function ensureProjectExists(db: AppDatabase, companyId: string, projectId: number) {
  const project = await db.orm.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}

async function ensureTaskExists(db: AppDatabase, companyId: string, taskId: number) {
  const task = await db.orm.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }
}

export const taskService = {
  async listProjectData(db: AppDatabase, companyId: string, options?: { activeOnly?: boolean }) {
    const projectRows = await db.orm.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      budget: projects.budget,
      is_active: projects.isActive,
      allow_all_users: projects.allowAllUsers,
      allow_all_tasks: projects.allowAllTasks,
      custom_field_values_json: projects.customFieldValuesJson,
      created_at: projects.createdAt,
    }).from(projects)
      .where(options?.activeOnly ? eq(projects.isActive, 1) : undefined)
      .orderBy(sql`projects.name COLLATE NOCASE ASC`, sql`projects.created_at DESC`);
    const taskRows = await db.orm.select({
      id: tasks.id,
      title: tasks.title,
      is_active: tasks.isActive,
      custom_field_values_json: tasks.customFieldValuesJson,
      created_at: tasks.createdAt,
    }).from(tasks)
      .where(options?.activeOnly ? eq(tasks.isActive, 1) : undefined)
      .orderBy(sql`tasks.title COLLATE NOCASE ASC`, sql`tasks.created_at DESC`);
    const userRows = await db.orm.select({
      id: users.id,
      full_name: users.fullName,
      is_active: users.isActive,
      role: users.role,
    }).from(users)
      .where(isNull(users.deletedAt))
      .orderBy(sql`full_name COLLATE NOCASE ASC`);
    const projectUserRows = await db.orm.select({
      project_id: projectUsers.projectId,
      user_id: projectUsers.userId,
      created_at: projectUsers.createdAt,
    }).from(projectUsers)
      .innerJoin(projects, eq(projects.id, projectUsers.projectId))
      .orderBy(asc(projectUsers.projectId), asc(projectUsers.userId), asc(projectUsers.createdAt));
    const projectTaskRows = await db.orm.select({
      project_id: projectTasks.projectId,
      task_id: projectTasks.taskId,
      created_at: projectTasks.createdAt,
    }).from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .orderBy(asc(projectTasks.projectId), asc(projectTasks.taskId), asc(projectTasks.createdAt));

    return {
      users: userRows.map((row: { id: number; full_name: string; is_active: number; role: "employee" | "manager" | "admin" }) => ({
        id: row.id,
        fullName: row.full_name,
        isActive: Boolean(row.is_active),
        role: row.role,
      })),
      projects: projectRows.map(mapProject),
      tasks: taskRows.map(mapTask),
      projectUsers: projectUserRows.map(mapProjectUserAssignment),
      projectTasks: projectTaskRows.map(mapProjectTaskAssignment)
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
    await db.orm.transaction(async (tx: any) => {
      const result = await tx.insert(projects).values({
        name: input.name.trim(),
        description: normalizeText(input.description),
        budget: Number(input.budget ?? 0),
        isActive: input.isActive === false ? 0 : 1,
        allowAllUsers: allowAllUsers ? 1 : 0,
        allowAllTasks: allowAllTasks ? 1 : 0,
        customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
        createdAt,
      }).returning({ id: projects.id });
      const projectId = Number(result[0]?.id);
      for (const userId of nextUserIds) {
        const user = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get();
        if (!user) {
          continue;
        }
        await tx.insert(projectUsers).values({ projectId, userId, createdAt }).run();
      }
      for (const taskId of nextTaskIds) {
        const task = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
        if (!task) {
          continue;
        }
        await tx.insert(projectTasks).values({ projectId, taskId, createdAt }).run();
      }
    });
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
    await db.orm.transaction(async (tx: any) => {
      await tx.update(projects).set({
        name: input.name.trim(),
        description: normalizeText(input.description),
        budget: Number(input.budget ?? 0),
        isActive: input.isActive ? 1 : 0,
        allowAllUsers: allowAllUsers ? 1 : 0,
        allowAllTasks: allowAllTasks ? 1 : 0,
        customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
      }).where(eq(projects.id, input.projectId)).run();
      await tx.delete(projectUsers).where(eq(projectUsers.projectId, input.projectId)).run();
      await tx.delete(projectTasks).where(eq(projectTasks.projectId, input.projectId)).run();
      for (const userId of nextUserIds) {
        const user = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get();
        if (user) {
          await tx.insert(projectUsers).values({ projectId: input.projectId, userId, createdAt: new Date().toISOString() }).run();
        }
      }
      for (const taskId of nextTaskIds) {
        const task = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
        if (task) {
          await tx.insert(projectTasks).values({ projectId: input.projectId, taskId, createdAt: new Date().toISOString() }).run();
        }
      }
    });
  },

  async deleteProject(db: AppDatabase, companyId: string, input: DeleteProjectInput) {
    await ensureProjectExists(db, companyId, input.projectId);
    await db.orm.transaction(async (tx: any) => {
      await tx.delete(projectTasks).where(eq(projectTasks.projectId, input.projectId)).run();
      await tx.delete(projectUsers).where(eq(projectUsers.projectId, input.projectId)).run();
      await tx.delete(projects).where(eq(projects.id, input.projectId)).run();
    });
  },

  async createTask(db: AppDatabase, companyId: string, input: CreateTaskInput) {
    await db.orm.insert(tasks).values({
      title: input.title.trim(),
      customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
      createdAt: new Date().toISOString(),
    }).run();
  },

  async updateTask(db: AppDatabase, companyId: string, input: UpdateTaskInput) {
    await ensureTaskExists(db, companyId, input.taskId);
    await db.orm.update(tasks).set({
      title: input.title.trim(),
      isActive: input.isActive ? 1 : 0,
      customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
    }).where(eq(tasks.id, input.taskId)).run();
  },

  async deleteTask(db: AppDatabase, companyId: string, input: DeleteTaskInput) {
    await ensureTaskExists(db, companyId, input.taskId);
    await db.orm.delete(tasks).where(eq(tasks.id, input.taskId)).run();
  },

  async setProjectUsers(db: AppDatabase, companyId: string, projectId: number, userIds: number[]) {
    await ensureProjectExists(db, companyId, projectId);
    await db.orm.transaction(async (tx: any) => {
      await tx.delete(projectUsers).where(eq(projectUsers.projectId, projectId)).run();
      for (const userId of Array.from(new Set(userIds))) {
        const user = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get();
        if (!user) {
          continue;
        }
        await tx.insert(projectUsers).values({ projectId, userId, createdAt: new Date().toISOString() }).run();
      }
    });
  },

  async setProjectTasks(db: AppDatabase, companyId: string, projectId: number, taskIds: number[]) {
    await ensureProjectExists(db, companyId, projectId);
    await db.orm.transaction(async (tx: any) => {
      await tx.delete(projectTasks).where(eq(projectTasks.projectId, projectId)).run();
      for (const taskId of Array.from(new Set(taskIds))) {
        const task = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
        if (!task) {
          continue;
        }
        await tx.insert(projectTasks).values({ projectId, taskId, createdAt: new Date().toISOString() }).run();
      }
    });
  }
};
