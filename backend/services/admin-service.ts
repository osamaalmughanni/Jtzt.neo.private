import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type {
  CompanySnapshot,
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DeleteInvitationCodeInput,
  DeleteCompanyInput,
  InvitationCodeListResponse
} from "../../shared/types/api";
import { destroyCompanyDatabase } from "../db/runtime-database";
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
  await db.batch([
    { sql: "DELETE FROM tasks", params: [] },
    { sql: "DELETE FROM projects", params: [] },
    { sql: "DELETE FROM time_entries", params: [] },
    { sql: "DELETE FROM user_contract_schedule_blocks", params: [] },
    { sql: "DELETE FROM user_contracts", params: [] },
    { sql: "DELETE FROM public_holiday_cache", params: [] },
    { sql: "DELETE FROM company_settings", params: [] },
    { sql: "DELETE FROM users", params: [] }
  ]);
}

async function seedCompanyAdmin(db: AppDatabase, companyId: string, payload: { username: string; password: string; fullName: string }) {
    const result = await db.run(
      `INSERT INTO users (
      username,
      full_name,
      password_hash,
      role,
      created_at
    ) VALUES (?, ?, ?, 'admin', ?)`,
    [payload.username, payload.fullName, bcrypt.hashSync(payload.password, 10), new Date().toISOString()]
  );
  return Number(result.lastRowId);
}

async function seedDefaultProjects(db: AppDatabase, companyId: string) {
  const existing = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM projects", []);
  if ((existing?.count ?? 0) > 0) {
    return;
  }
  await db.run("INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)", [
    "General",
    "Default project",
    new Date().toISOString()
  ]);
}

async function replaceCompanySnapshotInternal(db: AppDatabase, companyId: string, snapshot: CompanySnapshot) {
  validateSnapshot(snapshot);

  await deleteCompanyData(db, companyId);

  if (snapshot.settings) {
    await db.run(
      `INSERT INTO company_settings (
        currency,
        locale,
        time_zone,
        date_time_format,
        first_day_of_week,
        weekend_days_json,
        edit_days_limit,
        insert_days_limit,
        allow_one_record_per_day,
        allow_intersecting_records,
        allow_records_on_holidays,
        allow_records_on_weekends,
        allow_future_records,
        country,
        tablet_idle_timeout_seconds,
        auto_break_after_minutes,
        auto_break_duration_minutes,
        projects_enabled,
        tasks_enabled,
        overtime_settings_json,
        custom_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        snapshot.settings.currency,
        snapshot.settings.locale,
        snapshot.settings.timeZone,
        snapshot.settings.dateTimeFormat,
        snapshot.settings.firstDayOfWeek,
        JSON.stringify(snapshot.settings.weekendDays ?? DEFAULT_COMPANY_WEEKEND_DAYS),
        snapshot.settings.editDaysLimit,
        snapshot.settings.insertDaysLimit,
        snapshot.settings.allowOneRecordPerDay ? 1 : 0,
        snapshot.settings.allowIntersectingRecords ? 1 : 0,
        snapshot.settings.allowRecordsOnHolidays ? 1 : 0,
        snapshot.settings.allowRecordsOnWeekends ? 1 : 0,
        snapshot.settings.allowFutureRecords ? 1 : 0,
        snapshot.settings.country,
        snapshot.settings.tabletIdleTimeoutSeconds,
        snapshot.settings.autoBreakAfterMinutes,
        snapshot.settings.autoBreakDurationMinutes,
        snapshot.settings.projectsEnabled ? 1 : 0,
        snapshot.settings.tasksEnabled ? 1 : 0,
        JSON.stringify((snapshot.settings as { overtime?: unknown }).overtime ?? createDefaultOvertimeSettings()),
        JSON.stringify(snapshot.settings.customFields)
      ]
    );
  }

  const userIdMap = new Map<number, number>();
  for (const user of snapshot.users) {
    const result = await db.run(
      `INSERT INTO users (
        username,
        full_name,
        password_hash,
        role,
        is_active,
        deleted_at,
        pin_code,
        email,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        user.username,
        user.fullName,
        user.passwordHash,
        user.role,
        user.isActive ? 1 : 0,
        user.deletedAt ?? null,
        user.pinCode,
        user.email,
        JSON.stringify(user.customFieldValues ?? {}),
        user.createdAt
      ]
    );
    userIdMap.set(user.id, Number(result.lastRowId));
  }

  const projectIdMap = new Map<number, number>();
  for (const project of snapshot.projects) {
    const result = await db.run(
      `INSERT INTO projects (
        name,
        description,
        budget,
        is_active,
        allow_all_users,
        allow_all_tasks,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        project.name,
        project.description,
        project.budget ?? 0,
        project.isActive ? 1 : 0,
        project.allowAllUsers ? 1 : 0,
        project.allowAllTasks ? 1 : 0,
        JSON.stringify(project.customFieldValues ?? {}),
        project.createdAt
      ]
    );
    projectIdMap.set(project.id, Number(result.lastRowId));
  }

  const taskIdMap = new Map<number, number>();
  for (const task of snapshot.tasks) {
    const result = await db.run("INSERT INTO tasks (title, is_active, custom_field_values_json, created_at) VALUES (?, ?, ?, ?)", [
      task.title,
      task.isActive ? 1 : 0,
      JSON.stringify(task.customFieldValues ?? {}),
      task.createdAt
    ]);
    taskIdMap.set(task.id, Number(result.lastRowId));
  }

  for (const contract of snapshot.userContracts) {
    const userId = userIdMap.get(contract.userId);
    if (!userId) continue;
    const result = await db.run(
      `INSERT INTO user_contracts (
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        annual_vacation_days,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, contract.hoursPerWeek, contract.startDate, contract.endDate, contract.paymentPerHour, contract.annualVacationDays, contract.createdAt]
    );
    const contractId = Number(result.lastRowId);
    const schedule = Array.isArray((contract as { schedule?: unknown }).schedule) ? contract.schedule : [];
    for (const day of schedule) {
      for (const [blockIndex, block] of day.blocks.entries()) {
        await db.run(
          `INSERT INTO user_contract_schedule_blocks (
            contract_id,
            weekday,
            block_order,
            start_time,
            end_time,
            minutes
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [contractId, day.weekday, blockIndex + 1, block.startTime, block.endTime, block.minutes]
        );
      }
    }
  }

  for (const entry of snapshot.timeEntries) {
    const userId = userIdMap.get(entry.userId);
    if (!userId) continue;
    const projectId = entry.projectId != null ? projectIdMap.get(entry.projectId) ?? null : null;
    const taskId = entry.taskId != null ? taskIdMap.get(entry.taskId) ?? null : null;
    await db.run(
      `INSERT INTO time_entries (
        user_id,
        entry_type,
        entry_date,
        end_date,
        start_time,
        end_time,
        notes,
        project_id,
        task_id,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        entry.entryType,
        entry.entryDate,
        entry.endDate,
        entry.startTime ?? entry.entryDate,
        entry.endTime,
        entry.notes,
        projectId,
        taskId,
        JSON.stringify(entry.customFieldValues),
        entry.createdAt
      ]
    );
  }

  for (const cacheRow of snapshot.publicHolidayCache) {
    await db.run(
      `INSERT INTO public_holiday_cache (country_code, year, payload_json, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(country_code, year)
       DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      [
        cacheRow.countryCode,
        cacheRow.year,
        cacheRow.payloadJson,
        cacheRow.fetchedAt
      ]
    );
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
        await db.run("INSERT INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)", [
          mappedProjectId,
          mappedUserId,
          project.createdAt
        ]);
      }
    }

    if (!project.allowAllTasks) {
      for (const taskId of Array.from(new Set(project.taskIds ?? []))) {
        const mappedTaskId = taskIdMap.get(taskId);
        if (!mappedTaskId) {
          continue;
        }
        await db.run("INSERT INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)", [
          mappedProjectId,
          mappedTaskId,
          project.createdAt
        ]);
      }
    }
  }
}

export const adminService = {
  async createCompany(systemDb: AppDatabase, companyDb: AppDatabase, input: CreateCompanyInput, companyId: string = createCompanyId()) {
    const existing = await systemService.getCompanyByName(systemDb, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    const createdAt = new Date().toISOString();
    await systemDb.run(
      `INSERT INTO companies (
        id,
        name,
        created_at
      ) VALUES (?, ?, ?)`,
      [companyId, input.name.trim(), createdAt]
    );

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
      await systemDb.run("DELETE FROM companies WHERE id = ?", [companyId]);
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
    await systemDb.run(
      `INSERT INTO companies (
        id,
        name,
        created_at
      ) VALUES (?, ?, ?)`,
      [companyId, input.name.trim(), createdAt]
    );

    try {
      await replaceCompanySnapshotInternal(companyDb, companyId, {
        ...input.snapshot,
        company: {
          ...input.snapshot.company,
          createdAt
        }
      });
    } catch (error) {
      await systemDb.run("DELETE FROM companies WHERE id = ?", [companyId]);
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
    await systemDb.run("DELETE FROM companies WHERE id = ?", [input.companyId]);
    if (options?.config) {
      await destroyCompanyDatabase(options.config, input.companyId);
    }
  },

  async createCompanyAdmin(systemDb: AppDatabase, companyDb: AppDatabase, input: CreateCompanyAdminInput) {
    const company = await systemService.getCompanyById(systemDb, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }
    await companyDb.run(
      `INSERT INTO users (
        username,
        full_name,
        password_hash,
        role,
        created_at
      ) VALUES (?, ?, ?, 'admin', ?)`,
      [input.username.trim(), input.fullName.trim(), bcrypt.hashSync(input.password, 10), new Date().toISOString()]
    );
  },

  async getSystemStats(
    systemDb: AppDatabase,
    resolveCompanyDb: (companyId: string) => Promise<AppDatabase>,
  ) {
    const companyCount = (await systemDb.first<{ count: number }>("SELECT COUNT(*) as count FROM companies"))?.count ?? 0;
    const activeInvitationCodeCount =
      (await systemDb.first<{ count: number }>(
        "SELECT COUNT(*) as count FROM invitation_codes WHERE used_at IS NULL"
      ))?.count ?? 0;
    const companies = await systemDb.all<{ id: string }>("SELECT id FROM companies");
    let totalUsers = 0;
    let activeTimers = 0;

    for (const company of companies) {
      const companyDb = await resolveCompanyDb(company.id);
      totalUsers += (await companyDb.first<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL"))?.count ?? 0;
      activeTimers += (await companyDb.first<{ count: number }>("SELECT COUNT(*) as count FROM time_entries WHERE end_time IS NULL"))?.count ?? 0;
    }

    return {
      companyCount,
      activeInvitationCodeCount,
      totalUsers,
      activeTimers
    };
  },

  async listInvitationCodes(systemDb: AppDatabase): Promise<InvitationCodeListResponse["invitationCodes"]> {
    const rows = await systemDb.all(
      `SELECT
        invitation_codes.id,
        invitation_codes.code,
        invitation_codes.note,
        invitation_codes.created_at,
        invitation_codes.used_at,
        invitation_codes.used_by_company_id,
        companies.name AS used_by_company_name
       FROM invitation_codes
       LEFT JOIN companies ON companies.id = invitation_codes.used_by_company_id
       ORDER BY
         CASE
           WHEN invitation_codes.used_at IS NULL THEN 0
           WHEN invitation_codes.used_at IS NOT NULL THEN 1
         END,
         invitation_codes.created_at DESC`
    ) as Array<{
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
        const result = await systemDb.run(
          "INSERT INTO invitation_codes (code, note, created_at) VALUES (?, ?, ?)",
          [code, note, createdAt]
        );
        return {
          id: Number(result.lastRowId),
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
    const invitationCode = await systemDb.first<{ used_at: string | null }>(
      "SELECT used_at FROM invitation_codes WHERE id = ?",
      [input.invitationCodeId]
    );

    if (!invitationCode) {
      throw new HTTPException(404, { message: "Invitation code not found" });
    }

    await systemDb.run("DELETE FROM invitation_codes WHERE id = ?", [input.invitationCodeId]);
  },

  async exportCompanySnapshot(systemDb: AppDatabase, companyDb: AppDatabase, companyId: string): Promise<CompanySnapshot> {
    const company = await systemDb.first(
      `SELECT
        name,
        tablet_code_value,
        tablet_code_hash,
        tablet_code_updated_at,
        created_at
       FROM companies
       WHERE id = ?`,
      [companyId]
    ) as
      | {
          name: string;
          tablet_code_value: string | null;
          tablet_code_hash: string | null;
          tablet_code_updated_at: string | null;
          created_at: string;
        }
      | null;

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const settingsRow = await companyDb.first("SELECT * FROM company_settings LIMIT 1");
    const users = (await companyDb.all(
      "SELECT id, username, full_name, password_hash, role, is_active, deleted_at, pin_code, email, created_at FROM users ORDER BY id ASC",
      []
    ))
      .map(mapCompanyUser)
      .map((user) => ({
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

    const contractRows = await companyDb.all(
      "SELECT id, user_id, hours_per_week, start_date, end_date, payment_per_hour, annual_vacation_days, created_at FROM user_contracts ORDER BY id ASC",
      []
    ) as Array<{
      id: number;
      user_id: number;
      hours_per_week: number;
      start_date: string;
      end_date: string | null;
      payment_per_hour: number;
      annual_vacation_days: number;
      created_at: string;
    }>;
    const scheduleRows = await companyDb.all(
      `SELECT
        contract_id,
        weekday,
        block_order,
        start_time,
        end_time,
        minutes
       FROM user_contract_schedule_blocks
       WHERE contract_id IN (SELECT id FROM user_contracts)
       ORDER BY contract_id ASC, weekday ASC, block_order ASC`,
      []
    ) as Array<{
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
    const userContracts = contractRows.map((contract) => mapUserContract(contract, contractScheduleById.get(contract.id) ?? []));

    const timeEntries = (await companyDb.all(
      `SELECT
        id,
        user_id,
        entry_type,
        entry_date,
        end_date,
        start_time,
        end_time,
        notes,
        custom_field_values_json,
        created_at
       FROM time_entries
       ORDER BY id ASC`,
      []
    )).map(mapTimeEntry);

    const projectRows = await companyDb.all(
      "SELECT id, name, description, budget, is_active, allow_all_users, allow_all_tasks, custom_field_values_json, created_at FROM projects ORDER BY id ASC",
      []
    );
    const projectUserRows = await companyDb.all<{ project_id: number; user_id: number }>(
      "SELECT project_id, user_id FROM project_users WHERE project_id IN (SELECT id FROM projects)",
      []
    );
    const projectTaskRows = await companyDb.all<{ project_id: number; task_id: number }>(
      "SELECT project_id, task_id FROM project_tasks WHERE project_id IN (SELECT id FROM projects)",
      []
    );
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
    const projects = projectRows.map((row) => {
      const project = mapProject(row);
      return {
        ...project,
        userIds: project.allowAllUsers ? [] : Array.from(new Set(projectUsersByProjectId.get(project.id) ?? [])),
        taskIds: project.allowAllTasks ? [] : Array.from(new Set(projectTasksByProjectId.get(project.id) ?? [])),
      };
    });
    const tasks = (await companyDb.all("SELECT id, title, is_active, custom_field_values_json, created_at FROM tasks ORDER BY id ASC", [])).map(mapTask);
    const publicHolidayCache = await companyDb.all<{ country_code: string; year: number; payload_json: string; fetched_at: string }>(
      "SELECT country_code, year, payload_json, fetched_at FROM public_holiday_cache ORDER BY year ASC, country_code ASC",
      []
    );

    return {
      company: {
        name: company.name,
        tabletCodeValue: company.tablet_code_value,
        tabletCodeHash: company.tablet_code_hash,
        tabletCodeUpdatedAt: company.tablet_code_updated_at,
        createdAt: company.created_at
      },
      settings: settingsRow ? mapCompanySettings(settingsRow) : null,
      users,
      userContracts,
      timeEntries,
      projects,
      tasks,
      publicHolidayCache: publicHolidayCache.map((row) => ({
        countryCode: row.country_code,
        year: row.year,
        payloadJson: row.payload_json,
        fetchedAt: row.fetched_at
      }))
    };
  }
};
