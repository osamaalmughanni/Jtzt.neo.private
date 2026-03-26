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
import { mapCompanySettings, mapCompanyUser, mapProject, mapTask, mapTimeEntry, mapUserContract, mapUserContractScheduleDay } from "../db/mappers";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";
import { systemService } from "./system-service";
import { createLegacyContractSchedule } from "./user-contract-schedule";
import { createDefaultOvertimeSettings } from "../../shared/utils/overtime";

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
  if (!Array.isArray(snapshot.users) || !Array.isArray(snapshot.userContracts) || !Array.isArray(snapshot.timeEntries)) {
    throw new HTTPException(400, { message: "Company snapshot is incomplete" });
  }
}

async function deleteCompanyData(db: AppDatabase, companyId: string) {
  await db.batch([
    { sql: "DELETE FROM tasks WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM projects WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM time_entries WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM user_contract_schedule_days WHERE contract_id IN (SELECT id FROM user_contracts WHERE company_id = ?)", params: [companyId] },
    { sql: "DELETE FROM user_contracts WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM public_holiday_cache WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM company_settings WHERE company_id = ?", params: [companyId] },
    { sql: "DELETE FROM users WHERE company_id = ?", params: [companyId] }
  ]);
}

async function seedCompanyAdmin(db: AppDatabase, companyId: string, payload: { username: string; password: string; fullName: string }) {
  const result = await db.run(
    `INSERT INTO users (
      company_id,
      username,
      full_name,
      password_hash,
      role,
      created_at
    ) VALUES (?, ?, ?, ?, 'admin', ?)`,
    [companyId, payload.username, payload.fullName, bcrypt.hashSync(payload.password, 10), new Date().toISOString()]
  );
  return Number(result.lastRowId);
}

async function seedDefaultProjects(db: AppDatabase, companyId: string) {
  const existing = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM projects WHERE company_id = ?", [companyId]);
  if ((existing?.count ?? 0) > 0) {
    return;
  }
  await db.run("INSERT INTO projects (company_id, name, description, created_at) VALUES (?, ?, ?, ?)", [
    companyId,
    "General",
    "Default project",
    new Date().toISOString()
  ]);
}

async function replaceCompanySnapshotInternal(db: AppDatabase, companyId: string, snapshot: CompanySnapshot) {
  validateSnapshot(snapshot);

  await deleteCompanyData(db, companyId);
  await db.run(
    `UPDATE companies
     SET
       encryption_enabled = ?,
       encryption_kdf_algorithm = ?,
       encryption_kdf_iterations = ?,
       encryption_kdf_salt = ?,
       encryption_key_verifier = ?,
       tablet_code_value = ?,
       tablet_code_hash = ?,
       tablet_code_updated_at = ?
     WHERE id = ?`,
    [
      snapshot.company.encryptionEnabled ? 1 : 0,
      snapshot.company.encryptionKdfAlgorithm,
      snapshot.company.encryptionKdfIterations,
      snapshot.company.encryptionKdfSalt,
      snapshot.company.encryptionKeyVerifier,
      snapshot.company.tabletCodeValue,
      snapshot.company.tabletCodeHash,
      snapshot.company.tabletCodeUpdatedAt,
      companyId
    ]
  );

  if (snapshot.settings) {
    await db.run(
      `INSERT INTO company_settings (
        company_id,
        currency,
        locale,
        time_zone,
        date_time_format,
        first_day_of_week,
        edit_days_limit,
        insert_days_limit,
        allow_one_record_per_day,
        allow_intersecting_records,
        allow_records_on_holidays,
        allow_future_records,
        country,
        tablet_idle_timeout_seconds,
        auto_break_after_minutes,
        auto_break_duration_minutes,
        overtime_settings_json,
        custom_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        snapshot.settings.currency,
        snapshot.settings.locale,
        snapshot.settings.timeZone,
        snapshot.settings.dateTimeFormat,
        snapshot.settings.firstDayOfWeek,
        snapshot.settings.editDaysLimit,
        snapshot.settings.insertDaysLimit,
        snapshot.settings.allowOneRecordPerDay ? 1 : 0,
        snapshot.settings.allowIntersectingRecords ? 1 : 0,
        snapshot.settings.allowRecordsOnHolidays ? 1 : 0,
        snapshot.settings.allowFutureRecords ? 1 : 0,
        snapshot.settings.country,
        snapshot.settings.tabletIdleTimeoutSeconds,
        snapshot.settings.autoBreakAfterMinutes,
        snapshot.settings.autoBreakDurationMinutes,
        JSON.stringify((snapshot.settings as { overtime?: unknown }).overtime ?? createDefaultOvertimeSettings()),
        JSON.stringify(snapshot.settings.customFields)
      ]
    );
  }

  const userIdMap = new Map<number, number>();
  for (const user of snapshot.users) {
    const result = await db.run(
      `INSERT INTO users (
        company_id,
        username,
        full_name,
        password_hash,
        role,
        is_active,
        pin_code,
        email,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, user.username, user.fullName, user.passwordHash, user.role, user.isActive ? 1 : 0, user.pinCode, user.email, user.createdAt]
    );
    userIdMap.set(user.id, Number(result.lastRowId));
  }

  const projectIdMap = new Map<number, number>();
  for (const project of snapshot.projects) {
    const result = await db.run("INSERT INTO projects (company_id, name, description, is_active, created_at) VALUES (?, ?, ?, ?, ?)", [
      companyId,
      project.name,
      project.description,
      project.isActive ? 1 : 0,
      project.createdAt
    ]);
    projectIdMap.set(project.id, Number(result.lastRowId));
  }

  for (const contract of snapshot.userContracts) {
    const userId = userIdMap.get(contract.userId);
    if (!userId) continue;
    const result = await db.run(
      `INSERT INTO user_contracts (
        company_id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        annual_vacation_days,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, userId, contract.hoursPerWeek, contract.startDate, contract.endDate, contract.paymentPerHour, contract.annualVacationDays, contract.createdAt]
    );
    const contractId = Number(result.lastRowId);
    const schedule = Array.isArray((contract as { schedule?: unknown }).schedule) ? contract.schedule : createLegacyContractSchedule(contract.hoursPerWeek);
    for (const day of schedule) {
      await db.run(
        `INSERT INTO user_contract_schedule_days (
          contract_id,
          weekday,
          is_working_day,
          start_time,
          end_time,
          minutes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [contractId, day.weekday, day.isWorkingDay ? 1 : 0, day.startTime, day.endTime, day.minutes]
      );
    }
  }

  for (const task of snapshot.tasks) {
    const projectId = projectIdMap.get(task.projectId);
    if (!projectId) continue;
    await db.run("INSERT INTO tasks (company_id, project_id, title, is_active, created_at) VALUES (?, ?, ?, ?, ?)", [
      companyId,
      projectId,
      task.title,
      task.isActive ? 1 : 0,
      task.createdAt
    ]);
  }

  for (const entry of snapshot.timeEntries) {
    const userId = userIdMap.get(entry.userId);
    if (!userId) continue;
    await db.run(
      `INSERT INTO time_entries (
        company_id,
        user_id,
        entry_type,
        entry_date,
        end_date,
        start_time,
        end_time,
        notes,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        userId,
        entry.entryType,
        entry.entryDate,
        entry.endDate,
        entry.startTime ?? entry.entryDate,
        entry.endTime,
        entry.notes,
        JSON.stringify(entry.customFieldValues),
        entry.createdAt
      ]
    );
  }

  for (const cacheRow of snapshot.publicHolidayCache) {
    await db.run("INSERT INTO public_holiday_cache (company_id, country_code, year, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)", [
      companyId,
      cacheRow.countryCode,
      cacheRow.year,
      cacheRow.payloadJson,
      cacheRow.fetchedAt
    ]);
  }
}

export const adminService = {
  async createCompany(systemDb: AppDatabase, companyDb: AppDatabase, input: CreateCompanyInput, companyId: string = createCompanyId()) {
    const existing = await systemService.getCompanyByName(systemDb, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }
    if (input.encryptionEnabled && (!input.encryptionKdfSalt || !input.encryptionKdfIterations || !input.encryptionKeyVerifier)) {
      throw new HTTPException(400, { message: "Secure mode metadata is incomplete" });
    }

    const createdAt = new Date().toISOString();
    await systemDb.run(
      `INSERT INTO companies (
        id,
        name,
        encryption_enabled,
        encryption_kdf_algorithm,
        encryption_kdf_iterations,
        encryption_kdf_salt,
        encryption_key_verifier,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.name.trim(),
        input.encryptionEnabled ? 1 : 0,
        input.encryptionEnabled ? input.encryptionKdfAlgorithm ?? "pbkdf2-sha256" : null,
        input.encryptionEnabled ? input.encryptionKdfIterations ?? null : null,
        input.encryptionEnabled ? input.encryptionKdfSalt ?? null : null,
        input.encryptionEnabled ? input.encryptionKeyVerifier ?? null : null,
        createdAt
      ]
    );

    try {
      await seedCompanyAdmin(companyDb, companyId, {
        username: input.adminUsername.trim(),
        password: input.adminPassword,
        fullName: input.adminFullName.trim()
      });
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
        encryption_enabled,
        encryption_kdf_algorithm,
        encryption_kdf_iterations,
        encryption_kdf_salt,
        encryption_key_verifier,
        created_at
      ) VALUES (?, ?, 0, NULL, NULL, NULL, NULL, ?)`,
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
        company_id,
        username,
        full_name,
        password_hash,
        role,
        created_at
      ) VALUES (?, ?, ?, ?, 'admin', ?)`,
      [company.id, input.username.trim(), input.fullName.trim(), bcrypt.hashSync(input.password, 10), new Date().toISOString()]
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
      totalUsers += (await companyDb.first<{ count: number }>("SELECT COUNT(*) as count FROM users"))?.count ?? 0;
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
    if (invitationCode.used_at) {
      throw new HTTPException(409, { message: "Used invitation codes cannot be deleted" });
    }

    await systemDb.run("DELETE FROM invitation_codes WHERE id = ?", [input.invitationCodeId]);
  },

  async exportCompanySnapshot(systemDb: AppDatabase, companyDb: AppDatabase, companyId: string): Promise<CompanySnapshot> {
    const company = await systemDb.first(
      `SELECT
        name,
        encryption_enabled,
        encryption_kdf_algorithm,
        encryption_kdf_iterations,
        encryption_kdf_salt,
        encryption_key_verifier,
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
          encryption_enabled: number;
          encryption_kdf_algorithm: "pbkdf2-sha256" | null;
          encryption_kdf_iterations: number | null;
          encryption_kdf_salt: string | null;
          encryption_key_verifier: string | null;
          tablet_code_value: string | null;
          tablet_code_hash: string | null;
          tablet_code_updated_at: string | null;
          created_at: string;
        }
      | null;

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const settingsRow = await companyDb.first("SELECT * FROM company_settings WHERE company_id = ?", [companyId]);
    const users = (await companyDb.all(
      "SELECT id, username, full_name, password_hash, role, is_active, pin_code, email, created_at FROM users WHERE company_id = ? ORDER BY id ASC",
      [companyId]
    ))
      .map(mapCompanyUser)
      .map((user) => ({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        passwordHash: user.passwordHash,
        role: user.role,
        isActive: Boolean(user.isActive),
        pinCode: user.pinCode ?? "0000",
        email: user.email ?? null,
        createdAt: user.createdAt
      }));

    const contractRows = await companyDb.all(
      "SELECT id, user_id, hours_per_week, start_date, end_date, payment_per_hour, annual_vacation_days, created_at FROM user_contracts WHERE company_id = ? ORDER BY id ASC",
      [companyId]
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
        is_working_day,
        start_time,
        end_time,
        minutes
       FROM user_contract_schedule_days
       WHERE contract_id IN (SELECT id FROM user_contracts WHERE company_id = ?)
       ORDER BY contract_id ASC, weekday ASC`,
      [companyId]
    ) as Array<{
      contract_id: number;
      weekday: number;
      is_working_day: number;
      start_time: string | null;
      end_time: string | null;
      minutes: number;
    }>;
    const contractScheduleById = new Map<number, ReturnType<typeof mapUserContractScheduleDay>[]>();
    for (const row of scheduleRows) {
      const next = contractScheduleById.get(row.contract_id) ?? [];
      next.push(mapUserContractScheduleDay(row));
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
       WHERE company_id = ?
       ORDER BY id ASC`,
      [companyId]
    )).map(mapTimeEntry);

    const projects = (await companyDb.all("SELECT id, name, description, is_active, created_at FROM projects WHERE company_id = ? ORDER BY id ASC", [companyId])).map(
      mapProject
    );
    const tasks = (await companyDb.all("SELECT id, project_id, title, is_active, created_at FROM tasks WHERE company_id = ? ORDER BY id ASC", [companyId])).map(mapTask);
    const publicHolidayCache = await companyDb.all<{ country_code: string; year: number; payload_json: string; fetched_at: string }>(
      "SELECT country_code, year, payload_json, fetched_at FROM public_holiday_cache WHERE company_id = ? ORDER BY year ASC, country_code ASC",
      [companyId]
    );

    return {
      company: {
        name: company.name,
        encryptionEnabled: Boolean(company.encryption_enabled),
        encryptionKdfAlgorithm: company.encryption_kdf_algorithm,
        encryptionKdfIterations: company.encryption_kdf_iterations,
        encryptionKdfSalt: company.encryption_kdf_salt,
        encryptionKeyVerifier: company.encryption_key_verifier,
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
