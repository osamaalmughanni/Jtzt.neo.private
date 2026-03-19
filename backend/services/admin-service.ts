import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { CompanySnapshot, CreateCompanyAdminInput, CreateCompanyInput, DeleteCompanyInput } from "../../shared/types/api";
import { mapCompanySettings, mapCompanyUser, mapProject, mapTask, mapTimeEntry, mapUserContract } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";
import { systemService } from "./system-service";

function createCompanyId() {
  return crypto.randomUUID();
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
        country,
        tablet_idle_timeout_seconds,
        auto_break_after_minutes,
        auto_break_duration_minutes,
        custom_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        snapshot.settings.country,
        snapshot.settings.tabletIdleTimeoutSeconds,
        snapshot.settings.autoBreakAfterMinutes,
        snapshot.settings.autoBreakDurationMinutes,
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
    await db.run(
      `INSERT INTO user_contracts (
        company_id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, userId, contract.hoursPerWeek, contract.startDate, contract.endDate, contract.paymentPerHour, contract.createdAt]
    );
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
  async createCompany(db: AppDatabase, input: CreateCompanyInput) {
    const existing = await systemService.getCompanyByName(db, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }
    if (input.encryptionEnabled && (!input.encryptionKdfSalt || !input.encryptionKdfIterations || !input.encryptionKeyVerifier)) {
      throw new HTTPException(400, { message: "Secure mode metadata is incomplete" });
    }

    const companyId = createCompanyId();
    const createdAt = new Date().toISOString();
    await db.run(
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

    await seedCompanyAdmin(db, companyId, {
      username: input.adminUsername.trim(),
      password: input.adminPassword,
      fullName: input.adminFullName.trim()
    });
    await seedDefaultProjects(db, companyId);

    return systemService.getCompanyById(db, companyId);
  },

  async createCompanyFromSnapshot(db: AppDatabase, input: { name: string; snapshot: CompanySnapshot }) {
    const existing = await systemService.getCompanyByName(db, input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    validateSnapshot(input.snapshot);
    const companyId = createCompanyId();
    const createdAt = new Date().toISOString();
    await db.run(
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

    await replaceCompanySnapshotInternal(db, companyId, {
      ...input.snapshot,
      company: {
        ...input.snapshot.company,
        createdAt
      }
    });

    return systemService.getCompanyById(db, companyId);
  },

  async replaceCompanySnapshot(db: AppDatabase, input: { companyId: string; snapshot: CompanySnapshot }) {
    const company = await systemService.getCompanyById(db, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    await replaceCompanySnapshotInternal(db, input.companyId, input.snapshot);
    return systemService.getCompanyById(db, input.companyId);
  },

  async deleteCompany(db: AppDatabase, input: DeleteCompanyInput) {
    const company = await systemService.getCompanyById(db, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }
    await db.run("DELETE FROM companies WHERE id = ?", [input.companyId]);
  },

  async createCompanyAdmin(db: AppDatabase, input: CreateCompanyAdminInput) {
    const company = await systemService.getCompanyById(db, input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }
    await db.run(
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

  async getSystemStats(db: AppDatabase) {
    const companyCount = (await db.first<{ count: number }>("SELECT COUNT(*) as count FROM companies"))?.count ?? 0;
    const adminCount = (await db.first<{ count: number }>("SELECT COUNT(*) as count FROM admins"))?.count ?? 0;
    const totalUsers = (await db.first<{ count: number }>("SELECT COUNT(*) as count FROM users"))?.count ?? 0;
    const activeTimers = (await db.first<{ count: number }>("SELECT COUNT(*) as count FROM time_entries WHERE end_time IS NULL"))?.count ?? 0;

    return {
      companyCount,
      adminCount,
      totalUsers,
      activeTimers
    };
  },

  async exportCompanySnapshot(db: AppDatabase, companyId: string): Promise<CompanySnapshot> {
    const company = await db.first(
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

    const settingsRow = await db.first("SELECT * FROM company_settings WHERE company_id = ?", [companyId]);
    const users = (await db.all(
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

    const userContracts = (await db.all(
      "SELECT id, user_id, hours_per_week, start_date, end_date, payment_per_hour, created_at FROM user_contracts WHERE company_id = ? ORDER BY id ASC",
      [companyId]
    )).map(mapUserContract);

    const timeEntries = (await db.all(
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

    const projects = (await db.all("SELECT id, name, description, is_active, created_at FROM projects WHERE company_id = ? ORDER BY id ASC", [companyId])).map(
      mapProject
    );
    const tasks = (await db.all("SELECT id, project_id, title, is_active, created_at FROM tasks WHERE company_id = ? ORDER BY id ASC", [companyId])).map(mapTask);
    const publicHolidayCache = await db.all<{ country_code: string; year: number; payload_json: string; fetched_at: string }>(
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
