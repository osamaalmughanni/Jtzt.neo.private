import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  CompanySnapshot,
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DeleteInvitationCodeInput,
  DeleteCompanyInput,
  InvitationCodeListResponse
} from "../../shared/types/api";
import { destroyCompanyDatabase } from "../db/runtime-database";
import {
  companies,
  companySettings,
  invitationCodes,
  projectTasks,
  projectUsers,
  projects,
  publicHolidayCache,
  tasks,
  timeEntries,
  userContractScheduleBlocks,
  userContracts,
  users,
} from "../db/schema";
import { mapCompanySettings, mapCompanyUser, mapProject, mapTask, mapTimeEntry, mapUserContract, mapUserContractScheduleBlock } from "../db/mappers";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";
import { systemService } from "./system-service";
import { createDefaultOvertimeSettings } from "../../shared/utils/overtime";
import { DEFAULT_COMPANY_WEEKEND_DAYS } from "../../shared/utils/company-locale";

function createCompanyId() {
  return crypto.randomUUID();
}

function createInvitationCodeValue() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 12; index += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

function validateSnapshot(snapshot: CompanySnapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new HTTPException(400, { message: "Invalid company snapshot" });
  }
  if (
    !Array.isArray(snapshot.users) ||
    !Array.isArray(snapshot.userContracts) ||
    !Array.isArray(snapshot.timeEntries) ||
    !Array.isArray(snapshot.projects) ||
    !Array.isArray(snapshot.tasks)
  ) {
    throw new HTTPException(400, { message: "Company snapshot is incomplete" });
  }
}

async function deleteCompanyData(db: AppDatabase, companyId: string) {
  await db.orm.transaction((tx: any) => {
    tx.delete(projectTasks).run();
    tx.delete(projectUsers).run();
    tx.delete(tasks).run();
    tx.delete(projects).run();
    tx.delete(timeEntries).run();
    tx.delete(userContractScheduleBlocks).run();
    tx.delete(userContracts).run();
    tx.delete(publicHolidayCache).run();
    tx.delete(companySettings).run();
    tx.delete(users).run();
  });
}

async function seedCompanyAdmin(db: AppDatabase, companyId: string, payload: { username: string; password: string; fullName: string }) {
  const result = await db.orm.insert(users).values({
    username: payload.username,
    fullName: payload.fullName,
    passwordHash: bcrypt.hashSync(payload.password, 10),
    role: "admin",
    createdAt: new Date().toISOString(),
  }).returning({ id: users.id });
  return Number(result[0]?.id);
}

async function seedDefaultProjects(db: AppDatabase, companyId: string) {
  const existing = await db.orm.select({ count: sql<number>`count(*)` }).from(projects).get();
  if ((existing?.count ?? 0) > 0) {
    return;
  }
  await db.orm.insert(projects).values({
    name: "General",
    description: "Default project",
    createdAt: new Date().toISOString(),
  }).run();
}

async function replaceCompanySnapshotInternal(db: AppDatabase, companyId: string, snapshot: CompanySnapshot) {
  validateSnapshot(snapshot);

  await db.orm.transaction((tx: any) => {
    tx.delete(projectTasks).run();
    tx.delete(projectUsers).run();
    tx.delete(tasks).run();
    tx.delete(projects).run();
    tx.delete(timeEntries).run();
    tx.delete(userContractScheduleBlocks).run();
    tx.delete(userContracts).run();
    tx.delete(publicHolidayCache).run();
    tx.delete(companySettings).run();
    tx.delete(users).run();

    if (snapshot.settings) {
      tx.insert(companySettings).values({
        currency: snapshot.settings.currency,
        locale: snapshot.settings.locale,
        timeZone: snapshot.settings.timeZone,
        dateTimeFormat: snapshot.settings.dateTimeFormat,
        firstDayOfWeek: snapshot.settings.firstDayOfWeek,
        weekendDaysJson: JSON.stringify(snapshot.settings.weekendDays ?? DEFAULT_COMPANY_WEEKEND_DAYS),
        editDaysLimit: snapshot.settings.editDaysLimit,
        insertDaysLimit: snapshot.settings.insertDaysLimit,
        allowOneRecordPerDay: snapshot.settings.allowOneRecordPerDay ? 1 : 0,
        allowIntersectingRecords: snapshot.settings.allowIntersectingRecords ? 1 : 0,
        allowRecordsOnHolidays: snapshot.settings.allowRecordsOnHolidays ? 1 : 0,
        allowRecordsOnWeekends: snapshot.settings.allowRecordsOnWeekends ? 1 : 0,
        allowFutureRecords: snapshot.settings.allowFutureRecords ? 1 : 0,
        country: snapshot.settings.country,
        tabletIdleTimeoutSeconds: snapshot.settings.tabletIdleTimeoutSeconds,
        autoBreakAfterMinutes: snapshot.settings.autoBreakAfterMinutes,
        autoBreakDurationMinutes: snapshot.settings.autoBreakDurationMinutes,
        projectsEnabled: snapshot.settings.projectsEnabled ? 1 : 0,
        tasksEnabled: snapshot.settings.tasksEnabled ? 1 : 0,
        overtimeSettingsJson: JSON.stringify((snapshot.settings as { overtime?: unknown }).overtime ?? createDefaultOvertimeSettings()),
        customFieldsJson: JSON.stringify(snapshot.settings.customFields),
      }).run();
    }

    const userIdMap = new Map<number, number>();
    for (const user of snapshot.users) {
      const result = tx.insert(users).values({
        username: user.username,
        fullName: user.fullName,
        passwordHash: user.passwordHash,
        role: user.role,
        isActive: user.isActive ? 1 : 0,
        deletedAt: user.deletedAt ?? null,
        pinCode: user.pinCode,
        email: user.email,
        customFieldValuesJson: JSON.stringify(user.customFieldValues ?? {}),
        createdAt: user.createdAt,
      }).returning({ id: users.id });
      userIdMap.set(user.id, Number(result[0]?.id));
    }

    const projectIdMap = new Map<number, number>();
    for (const project of snapshot.projects) {
      const result = tx.insert(projects).values({
        name: project.name,
        description: project.description,
        budget: project.budget ?? 0,
        isActive: project.isActive ? 1 : 0,
        allowAllUsers: project.allowAllUsers ? 1 : 0,
        allowAllTasks: project.allowAllTasks ? 1 : 0,
        customFieldValuesJson: JSON.stringify(project.customFieldValues ?? {}),
        createdAt: project.createdAt,
      }).returning({ id: projects.id });
      projectIdMap.set(project.id, Number(result[0]?.id));
    }

    const taskIdMap = new Map<number, number>();
    for (const task of snapshot.tasks) {
      const result = tx.insert(tasks).values({
        title: task.title,
        isActive: task.isActive ? 1 : 0,
        customFieldValuesJson: JSON.stringify(task.customFieldValues ?? {}),
        createdAt: task.createdAt,
      }).returning({ id: tasks.id });
      taskIdMap.set(task.id, Number(result[0]?.id));
    }

    for (const contract of snapshot.userContracts) {
      const userId = userIdMap.get(contract.userId);
      if (!userId) continue;
      const result = tx.insert(userContracts).values({
        userId,
        hoursPerWeek: contract.hoursPerWeek,
        startDate: contract.startDate,
        endDate: contract.endDate,
        paymentPerHour: contract.paymentPerHour,
        annualVacationDays: contract.annualVacationDays,
        createdAt: contract.createdAt,
      }).returning({ id: userContracts.id });
      const contractId = Number(result[0]?.id);
      const schedule = Array.isArray((contract as { schedule?: unknown }).schedule) ? contract.schedule : [];
      for (const day of schedule) {
        for (const [blockIndex, block] of day.blocks.entries()) {
          tx.insert(userContractScheduleBlocks).values({
            contractId,
            weekday: day.weekday,
            blockOrder: blockIndex + 1,
            startTime: block.startTime,
            endTime: block.endTime,
            minutes: block.minutes,
          }).run();
        }
      }
    }

    for (const entry of snapshot.timeEntries) {
      const userId = userIdMap.get(entry.userId);
      if (!userId) continue;
      const projectId = entry.projectId != null ? projectIdMap.get(entry.projectId) ?? null : null;
      const taskId = entry.taskId != null ? taskIdMap.get(entry.taskId) ?? null : null;
      tx.insert(timeEntries).values({
        userId,
        entryType: entry.entryType,
        entryDate: entry.entryDate,
        endDate: entry.endDate,
        startTime: entry.startTime ?? entry.entryDate,
        endTime: entry.endTime,
        notes: entry.notes,
        projectId,
        taskId,
        customFieldValuesJson: JSON.stringify(entry.customFieldValues),
        createdAt: entry.createdAt,
      }).run();
    }

    for (const cacheRow of snapshot.publicHolidayCache) {
      tx.insert(publicHolidayCache).values({
        countryCode: cacheRow.countryCode,
        year: cacheRow.year,
        payloadJson: cacheRow.payloadJson,
        fetchedAt: cacheRow.fetchedAt,
      }).onConflictDoUpdate({
        target: [publicHolidayCache.countryCode, publicHolidayCache.year],
        set: {
          payloadJson: cacheRow.payloadJson,
          fetchedAt: cacheRow.fetchedAt,
        },
      }).run();
    }

    for (const project of snapshot.projects) {
      const mappedProjectId = projectIdMap.get(project.id);
      if (!mappedProjectId) {
        continue;
      }

      if (!project.allowAllUsers) {
        for (const userId of Array.from(new Set(project.userIds ?? []))) {
          const mappedUserId = userIdMap.get(userId);
          if (!mappedUserId) {
            continue;
          }
          tx.insert(projectUsers).values({
            projectId: mappedProjectId,
            userId: mappedUserId,
            createdAt: project.createdAt,
          }).run();
        }
      }

      if (!project.allowAllTasks) {
        for (const taskId of Array.from(new Set(project.taskIds ?? []))) {
          const mappedTaskId = taskIdMap.get(taskId);
          if (!mappedTaskId) {
            continue;
          }
          tx.insert(projectTasks).values({
            projectId: mappedProjectId,
            taskId: mappedTaskId,
            createdAt: project.createdAt,
          }).run();
        }
      }
    }
  });
}

export const adminService = {
  async createCompany(systemDb: AppDatabase, companyDb: AppDatabase, input: CreateCompanyInput, companyId: string = createCompanyId()) {
    const existing = await systemService.getCompanyByName(systemDb, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    const createdAt = new Date().toISOString();
    await systemDb.orm.insert(companies).values({
      id: companyId,
      name: input.name.trim(),
      createdAt,
    }).run();

    try {
      if (input.adminUsername && input.adminPassword && input.adminFullName) {
        await seedCompanyAdmin(companyDb, companyId, {
          username: input.adminUsername.trim(),
          password: input.adminPassword,
          fullName: input.adminFullName.trim()
        });
      }
      await seedDefaultProjects(companyDb, companyId);
    } catch (error) {
      await systemDb.orm.delete(companies).where(eq(companies.id, companyId)).run();
      throw error;
    }

    return systemService.getCompanyById(systemDb, companyId);
  },

  async createCompanyFromSnapshot(systemDb: AppDatabase, companyDb: AppDatabase, input: { name: string; snapshot: CompanySnapshot }, companyId: string = createCompanyId()) {
    const existing = await systemService.getCompanyByName(systemDb, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    validateSnapshot(input.snapshot);
    const createdAt = new Date().toISOString();
    await systemDb.orm.insert(companies).values({
      id: companyId,
      name: input.name.trim(),
      createdAt,
    }).run();

    try {
      await replaceCompanySnapshotInternal(companyDb, companyId, {
        ...input.snapshot,
        company: {
          ...input.snapshot.company,
          createdAt
        }
      });
    } catch (error) {
      await systemDb.orm.delete(companies).where(eq(companies.id, companyId)).run();
      throw error;
    }

    return systemService.getCompanyById(systemDb, companyId);
  },

  async replaceCompanySnapshot(systemDb: AppDatabase, companyDb: AppDatabase, input: { companyId: string; snapshot: CompanySnapshot }) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    await replaceCompanySnapshotInternal(companyDb, input.companyId, input.snapshot);
    return systemService.getCompanyById(systemDb, input.companyId);
  },

  async deleteCompany(
    systemDb: AppDatabase,
    companyDb: AppDatabase,
    input: DeleteCompanyInput,
    options?: { config?: RuntimeConfig },
  ) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }
    await deleteCompanyData(companyDb, input.companyId);
    await systemDb.orm.delete(companies).where(eq(companies.id, input.companyId)).run();
    if (options?.config) {
      await destroyCompanyDatabase(options.config, input.companyId);
    }
  },

  async createCompanyAdmin(systemDb: AppDatabase, companyDb: AppDatabase, input: CreateCompanyAdminInput) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }
    await companyDb.orm.insert(users).values({
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: "admin",
      createdAt: new Date().toISOString(),
    }).run();
  },

  async getSystemStats(
    systemDb: AppDatabase,
    resolveCompanyDb: (companyId: string) => Promise<AppDatabase>,
  ) {
    const companyCount = (await systemDb.orm.select({ count: sql<number>`count(*)` }).from(companies).get())?.count ?? 0;
    const activeInvitationCodeCount =
      (await systemDb.orm.select({ count: sql<number>`count(*)` }).from(invitationCodes).where(isNull(invitationCodes.usedAt)).get())?.count ?? 0;
    const companyRows = await systemDb.orm.select({ id: companies.id }).from(companies);
    let totalUsers = 0;
    let activeTimers = 0;

    for (const company of companyRows) {
      const companyDb = await resolveCompanyDb(company.id);
      totalUsers += (await companyDb.orm.select({ count: sql<number>`count(*)` }).from(users).where(isNull(users.deletedAt)).get())?.count ?? 0;
      activeTimers += (await companyDb.orm.select({ count: sql<number>`count(*)` }).from(timeEntries).where(isNull(timeEntries.endTime)).get())?.count ?? 0;
    }

    return {
      companyCount,
      activeInvitationCodeCount,
      totalUsers,
      activeTimers
    };
  },

  async listInvitationCodes(systemDb: AppDatabase): Promise<InvitationCodeListResponse["invitationCodes"]> {
    const rows = await systemDb.orm.select({
      id: invitationCodes.id,
      code: invitationCodes.code,
      note: invitationCodes.note,
      created_at: invitationCodes.createdAt,
      used_at: invitationCodes.usedAt,
      used_by_company_id: invitationCodes.usedByCompanyId,
      used_by_company_name: companies.name,
    }).from(invitationCodes)
      .leftJoin(companies, eq(companies.id, invitationCodes.usedByCompanyId))
      .orderBy(sql`CASE WHEN ${invitationCodes.usedAt} IS NULL THEN 0 ELSE 1 END`, desc(invitationCodes.createdAt)) as Array<{
      id: number;
      code: string;
      note: string | null;
      created_at: string;
      used_at: string | null;
      used_by_company_id: string | null;
      used_by_company_name: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      note: row.note ?? null,
      createdAt: row.created_at,
      usedAt: row.used_at ?? null,
      usedByCompanyId: row.used_by_company_id ?? null,
      usedByCompanyName: row.used_by_company_name ?? null
    }));
  },

  async createInvitationCode(systemDb: AppDatabase, input: { note?: string }) {
    const createdAt = new Date().toISOString();
    const note = input.note?.trim() || null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createInvitationCodeValue();
      try {
        const result = await systemDb.orm.insert(invitationCodes).values({
          code,
          note,
          createdAt,
        }).returning({ id: invitationCodes.id });
        return {
          id: Number(result[0]?.id),
          code,
          note,
          createdAt,
          usedAt: null,
          usedByCompanyId: null,
          usedByCompanyName: null
        };
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE")) {
          throw error;
        }
      }
    }

    throw new HTTPException(500, { message: "Invitation code could not be generated" });
  },

  async deleteInvitationCode(systemDb: AppDatabase, input: DeleteInvitationCodeInput) {
    const invitationCode = await systemDb.orm.select({
      used_at: invitationCodes.usedAt,
    }).from(invitationCodes).where(eq(invitationCodes.id, input.invitationCodeId)).get();

    if (!invitationCode) {
      throw new HTTPException(404, { message: "Invitation code not found" });
    }

    await systemDb.orm.delete(invitationCodes).where(eq(invitationCodes.id, input.invitationCodeId)).run();
  },

  async exportCompanySnapshot(systemDb: AppDatabase, companyDb: AppDatabase, companyId: string): Promise<CompanySnapshot> {
    const company = await systemDb.orm.select({
      name: companies.name,
      tablet_code_value: companies.tabletCodeValue,
      tablet_code_hash: companies.tabletCodeHash,
      tablet_code_updated_at: companies.tabletCodeUpdatedAt,
      created_at: companies.createdAt,
    }).from(companies).where(eq(companies.id, companyId)).get();

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const settingsRow = await companyDb.orm.select().from(companySettings).limit(1).get();
    const userRows = await companyDb.orm.select({
      id: users.id,
      username: users.username,
      full_name: users.fullName,
      password_hash: users.passwordHash,
      role: users.role,
      is_active: users.isActive,
      deleted_at: users.deletedAt,
      pin_code: users.pinCode,
      email: users.email,
      custom_field_values_json: users.customFieldValuesJson,
      created_at: users.createdAt,
    }).from(users).orderBy(asc(users.id));
    const usersSnapshot = userRows
      .map(mapCompanyUser)
      .map((user: ReturnType<typeof mapCompanyUser>) => ({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        passwordHash: user.passwordHash,
        role: user.role,
        isActive: Boolean(user.isActive),
        deletedAt: user.deletedAt ?? null,
        pinCode: user.pinCode ?? "0000",
        email: user.email ?? null,
        customFieldValues: user.customFieldValues ?? {},
        createdAt: user.createdAt
      }));

    const contractRows = await companyDb.orm.select({
      id: userContracts.id,
      user_id: userContracts.userId,
      hours_per_week: userContracts.hoursPerWeek,
      start_date: userContracts.startDate,
      end_date: userContracts.endDate,
      payment_per_hour: userContracts.paymentPerHour,
      annual_vacation_days: userContracts.annualVacationDays,
      created_at: userContracts.createdAt,
    }).from(userContracts).orderBy(asc(userContracts.id)) as Array<{
      id: number;
      user_id: number;
      hours_per_week: number;
      start_date: string;
      end_date: string | null;
      payment_per_hour: number;
      annual_vacation_days: number;
      created_at: string;
    }>;
    const scheduleRows = await companyDb.orm.select({
      contract_id: userContractScheduleBlocks.contractId,
      weekday: userContractScheduleBlocks.weekday,
      block_order: userContractScheduleBlocks.blockOrder,
      start_time: userContractScheduleBlocks.startTime,
      end_time: userContractScheduleBlocks.endTime,
      minutes: userContractScheduleBlocks.minutes,
    }).from(userContractScheduleBlocks)
      .orderBy(asc(userContractScheduleBlocks.contractId), asc(userContractScheduleBlocks.weekday), asc(userContractScheduleBlocks.blockOrder)) as Array<{
      contract_id: number;
      weekday: number;
      block_order: number;
      start_time: string;
      end_time: string;
      minutes: number;
    }>;
    const contractScheduleById = new Map<number, ReturnType<typeof mapUserContractScheduleBlock>[]>();
    for (const row of scheduleRows) {
      const next = contractScheduleById.get(row.contract_id) ?? [];
      next.push(mapUserContractScheduleBlock(row));
      contractScheduleById.set(row.contract_id, next);
    }
    const userContractsSnapshot = contractRows.map((contract: (typeof contractRows)[number]) =>
      mapUserContract(contract, contractScheduleById.get(contract.id) ?? [])
    );

    const timeEntriesSnapshot = (await companyDb.orm.select({
      id: timeEntries.id,
      user_id: timeEntries.userId,
      entry_type: timeEntries.entryType,
      entry_date: timeEntries.entryDate,
      end_date: timeEntries.endDate,
      start_time: timeEntries.startTime,
      end_time: timeEntries.endTime,
      notes: timeEntries.notes,
      project_id: timeEntries.projectId,
      task_id: timeEntries.taskId,
      custom_field_values_json: timeEntries.customFieldValuesJson,
      created_at: timeEntries.createdAt,
    }).from(timeEntries).orderBy(asc(timeEntries.id))).map(mapTimeEntry);

    const projectRows = await companyDb.orm.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      budget: projects.budget,
      is_active: projects.isActive,
      allow_all_users: projects.allowAllUsers,
      allow_all_tasks: projects.allowAllTasks,
      custom_field_values_json: projects.customFieldValuesJson,
      created_at: projects.createdAt,
    }).from(projects).orderBy(asc(projects.id));
    const projectUserRows = await companyDb.orm.select({
      project_id: projectUsers.projectId,
      user_id: projectUsers.userId,
    }).from(projectUsers);
    const projectTaskRows = await companyDb.orm.select({
      project_id: projectTasks.projectId,
      task_id: projectTasks.taskId,
    }).from(projectTasks);
    const projectUsersByProjectId = new Map<number, number[]>();
    for (const row of projectUserRows) {
      const next = projectUsersByProjectId.get(row.project_id) ?? [];
      next.push(row.user_id);
      projectUsersByProjectId.set(row.project_id, next);
    }
    const projectTasksByProjectId = new Map<number, number[]>();
    for (const row of projectTaskRows) {
      const next = projectTasksByProjectId.get(row.project_id) ?? [];
      next.push(row.task_id);
      projectTasksByProjectId.set(row.project_id, next);
    }
    const projectsSnapshot = projectRows.map((row: (typeof projectRows)[number]) => {
      const project = mapProject(row);
      return {
        ...project,
        userIds: project.allowAllUsers ? [] : Array.from(new Set(projectUsersByProjectId.get(project.id) ?? [])),
        taskIds: project.allowAllTasks ? [] : Array.from(new Set(projectTasksByProjectId.get(project.id) ?? [])),
      };
    });
    const tasksSnapshot = (await companyDb.orm.select({
      id: tasks.id,
      title: tasks.title,
      is_active: tasks.isActive,
      custom_field_values_json: tasks.customFieldValuesJson,
      created_at: tasks.createdAt,
    }).from(tasks).orderBy(asc(tasks.id))).map(mapTask);
    const publicHolidayCacheSnapshot = await companyDb.orm.select({
      country_code: publicHolidayCache.countryCode,
      year: publicHolidayCache.year,
      payload_json: publicHolidayCache.payloadJson,
      fetched_at: publicHolidayCache.fetchedAt,
    }).from(publicHolidayCache).orderBy(asc(publicHolidayCache.year), asc(publicHolidayCache.countryCode));

    return {
      company: {
        name: company.name,
        tabletCodeValue: company.tablet_code_value,
        tabletCodeHash: company.tablet_code_hash,
        tabletCodeUpdatedAt: company.tablet_code_updated_at,
        createdAt: company.created_at
      },
      settings: settingsRow ? mapCompanySettings(settingsRow) : null,
      users: usersSnapshot,
      userContracts: userContractsSnapshot,
      timeEntries: timeEntriesSnapshot,
      projects: projectsSnapshot,
      tasks: tasksSnapshot,
      publicHolidayCache: publicHolidayCacheSnapshot.map((row: (typeof publicHolidayCacheSnapshot)[number]) => ({
        countryCode: row.country_code,
        year: row.year,
        payloadJson: row.payload_json,
        fetchedAt: row.fetched_at
      }))
    };
  }
};
