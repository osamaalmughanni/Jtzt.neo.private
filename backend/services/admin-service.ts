import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type {
  CompanySnapshot,
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DeleteCompanyInput
} from "../../shared/types/api";
import { deleteCompanyData, getCompanyDb, seedCompanyAdmin, seedDefaultProjects } from "../db/company-db";
import { getSystemDb } from "../db/system-db";
import { mapCompanySettings, mapCompanyUser, mapProject, mapTask, mapTimeEntry, mapUserContract } from "../db/mappers";
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

function replaceCompanySnapshot(companyId: string, snapshot: CompanySnapshot) {
  validateSnapshot(snapshot);
  const db = getCompanyDb(companyId);
  const transaction = db.transaction(() => {
    deleteCompanyData(companyId);

    db.prepare(
      `UPDATE companies
       SET
         encryption_enabled = @encryptionEnabled,
         encryption_kdf_algorithm = @encryptionKdfAlgorithm,
         encryption_kdf_iterations = @encryptionKdfIterations,
         encryption_kdf_salt = @encryptionKdfSalt,
         encryption_key_verifier = @encryptionKeyVerifier,
         tablet_code_value = @tabletCodeValue,
         tablet_code_hash = @tabletCodeHash,
         tablet_code_updated_at = @tabletCodeUpdatedAt
       WHERE id = @companyId`
    ).run({
      companyId,
      encryptionEnabled: snapshot.company.encryptionEnabled ? 1 : 0,
      encryptionKdfAlgorithm: snapshot.company.encryptionKdfAlgorithm,
      encryptionKdfIterations: snapshot.company.encryptionKdfIterations,
      encryptionKdfSalt: snapshot.company.encryptionKdfSalt,
      encryptionKeyVerifier: snapshot.company.encryptionKeyVerifier,
      tabletCodeValue: snapshot.company.tabletCodeValue,
      tabletCodeHash: snapshot.company.tabletCodeHash,
      tabletCodeUpdatedAt: snapshot.company.tabletCodeUpdatedAt
    });

    if (snapshot.settings) {
      db.prepare(
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
        ) VALUES (
          @companyId,
          @currency,
          @locale,
          @timeZone,
          @dateTimeFormat,
          @firstDayOfWeek,
          @editDaysLimit,
          @insertDaysLimit,
          @allowOneRecordPerDay,
          @allowIntersectingRecords,
          @country,
          @tabletIdleTimeoutSeconds,
          @autoBreakAfterMinutes,
          @autoBreakDurationMinutes,
          @customFieldsJson
        )`
      ).run({
        companyId,
        ...snapshot.settings,
        allowOneRecordPerDay: snapshot.settings.allowOneRecordPerDay ? 1 : 0,
        allowIntersectingRecords: snapshot.settings.allowIntersectingRecords ? 1 : 0,
        customFieldsJson: JSON.stringify(snapshot.settings.customFields)
      });
    }

    const userIdMap = new Map<number, number>();
    const insertUser = db.prepare(
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const user of snapshot.users) {
      const result = insertUser.run(
        companyId,
        user.username,
        user.fullName,
        user.passwordHash,
        user.role,
        user.isActive ? 1 : 0,
        user.pinCode,
        user.email,
        user.createdAt
      );
      userIdMap.set(user.id, Number(result.lastInsertRowid));
    }

    const insertContract = db.prepare(
      `INSERT INTO user_contracts (
        company_id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const contract of snapshot.userContracts) {
      const userId = userIdMap.get(contract.userId);
      if (!userId) continue;
      insertContract.run(
        companyId,
        userId,
        contract.hoursPerWeek,
        contract.startDate,
        contract.endDate,
        contract.paymentPerHour,
        contract.createdAt
      );
    }

    const projectIdMap = new Map<number, number>();
    const insertProject = db.prepare(
      "INSERT INTO projects (company_id, name, description, is_active, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const project of snapshot.projects) {
      const result = insertProject.run(companyId, project.name, project.description, project.isActive ? 1 : 0, project.createdAt);
      projectIdMap.set(project.id, Number(result.lastInsertRowid));
    }

    const insertTask = db.prepare(
      "INSERT INTO tasks (company_id, project_id, title, is_active, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const task of snapshot.tasks) {
      const projectId = projectIdMap.get(task.projectId);
      if (!projectId) continue;
      insertTask.run(companyId, projectId, task.title, task.isActive ? 1 : 0, task.createdAt);
    }

    const insertEntry = db.prepare(
      `INSERT INTO time_entries (
        company_id,
        user_id,
        entry_type,
        entry_date,
        end_date,
        start_time,
        end_time,
        notes,
        sick_leave_attachment_name,
        sick_leave_attachment_mime_type,
        sick_leave_attachment_data_url,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const entry of snapshot.timeEntries) {
      const userId = userIdMap.get(entry.userId);
      if (!userId) continue;
      insertEntry.run(
        companyId,
        userId,
        entry.entryType,
        entry.entryDate,
        entry.endDate,
        entry.startTime ?? entry.entryDate,
        entry.endTime,
        entry.notes,
        entry.sickLeaveAttachment?.fileName ?? null,
        entry.sickLeaveAttachment?.mimeType ?? null,
        entry.sickLeaveAttachment?.dataUrl ?? null,
        JSON.stringify(entry.customFieldValues),
        entry.createdAt
      );
    }

    const insertHolidayCache = db.prepare(
      "INSERT INTO public_holiday_cache (company_id, country_code, year, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const cacheRow of snapshot.publicHolidayCache) {
      insertHolidayCache.run(companyId, cacheRow.countryCode, cacheRow.year, cacheRow.payloadJson, cacheRow.fetchedAt);
    }
  });

  transaction();
}

export const adminService = {
  createCompany(input: CreateCompanyInput) {
    const existing = systemService.getCompanyByName(input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    if (input.encryptionEnabled) {
      if (!input.encryptionKdfSalt || !input.encryptionKdfIterations || !input.encryptionKeyVerifier) {
        throw new HTTPException(400, { message: "Secure mode metadata is incomplete" });
      }
    }

    const createdAt = new Date().toISOString();
    const companyId = createCompanyId();

    getSystemDb()
      .prepare(
        `INSERT INTO companies (
          id,
          name,
          encryption_enabled,
          encryption_kdf_algorithm,
          encryption_kdf_iterations,
          encryption_kdf_salt,
          encryption_key_verifier,
          created_at
        ) VALUES (
          @id,
          @name,
          @encryptionEnabled,
          @encryptionKdfAlgorithm,
          @encryptionKdfIterations,
          @encryptionKdfSalt,
          @encryptionKeyVerifier,
          @createdAt
        )`
      )
      .run({
        id: companyId,
        name: input.name.trim(),
        encryptionEnabled: input.encryptionEnabled ? 1 : 0,
        encryptionKdfAlgorithm: input.encryptionEnabled ? input.encryptionKdfAlgorithm ?? "pbkdf2-sha256" : null,
        encryptionKdfIterations: input.encryptionEnabled ? input.encryptionKdfIterations ?? null : null,
        encryptionKdfSalt: input.encryptionEnabled ? input.encryptionKdfSalt ?? null : null,
        encryptionKeyVerifier: input.encryptionEnabled ? input.encryptionKeyVerifier ?? null : null,
        createdAt
      });

    seedCompanyAdmin(companyId, {
      username: input.adminUsername.trim(),
      password: input.adminPassword,
      fullName: input.adminFullName.trim()
    });
    seedDefaultProjects(companyId);

    return systemService.getCompanyById(companyId);
  },

  createCompanyFromSnapshot(input: { name: string; snapshot: CompanySnapshot }) {
    const existing = systemService.getCompanyByName(input.name);
    if (existing) {
      throw new HTTPException(409, { message: "Company already exists" });
    }

    validateSnapshot(input.snapshot);
    const companyId = createCompanyId();
    const createdAt = new Date().toISOString();
    getSystemDb()
      .prepare(
        `INSERT INTO companies (
          id,
          name,
          encryption_enabled,
          encryption_kdf_algorithm,
          encryption_kdf_iterations,
          encryption_kdf_salt,
          encryption_key_verifier,
          created_at
        ) VALUES (?, ?, 0, NULL, NULL, NULL, NULL, ?)`
      )
      .run(companyId, input.name.trim(), createdAt);

    replaceCompanySnapshot(companyId, {
      ...input.snapshot,
      company: {
        ...input.snapshot.company,
        createdAt
      }
    });

    return systemService.getCompanyById(companyId);
  },

  replaceCompanySnapshot(input: { companyId: string; snapshot: CompanySnapshot }) {
    const company = systemService.getCompanyById(input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    replaceCompanySnapshot(input.companyId, input.snapshot);
    return systemService.getCompanyById(input.companyId);
  },

  deleteCompany(input: DeleteCompanyInput) {
    const company = systemService.getCompanyById(input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    getSystemDb().prepare("DELETE FROM companies WHERE id = ?").run(input.companyId);
  },

  createCompanyAdmin(input: CreateCompanyAdminInput) {
    const company = systemService.getCompanyById(input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    getCompanyDb(company.id)
      .prepare(
        `INSERT INTO users (
          company_id,
          username,
          full_name,
          password_hash,
          role,
          created_at
        ) VALUES (
          @companyId,
          @username,
          @fullName,
          @passwordHash,
          'admin',
          @createdAt
        )`
      )
      .run({
        companyId: company.id,
        username: input.username.trim(),
        fullName: input.fullName.trim(),
        passwordHash: bcrypt.hashSync(input.password, 10),
        createdAt: new Date().toISOString()
      });
  },

  getSystemStats() {
    const db = getSystemDb();
    const companyCount = (db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number }).count;
    const adminCount = (db.prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number }).count;
    const totalUsers = (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
    const activeTimers = (db.prepare("SELECT COUNT(*) as count FROM time_entries WHERE end_time IS NULL").get() as { count: number }).count;

    return {
      companyCount,
      adminCount,
      totalUsers,
      activeTimers
    };
  },

  exportCompanySnapshot(companyId: string): CompanySnapshot {
    const db = getCompanyDb(companyId);
    const company = db
      .prepare(
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
         WHERE id = ?`
      )
      .get(companyId) as
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
      | undefined;

    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const settingsRow = db.prepare("SELECT * FROM company_settings WHERE company_id = ?").get(companyId);
    const users = db
      .prepare("SELECT id, username, full_name, password_hash, role, is_active, pin_code, email, created_at FROM users WHERE company_id = ? ORDER BY id ASC")
      .all(companyId)
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

    const userContracts = db
      .prepare("SELECT id, user_id, hours_per_week, start_date, end_date, payment_per_hour, created_at FROM user_contracts WHERE company_id = ? ORDER BY id ASC")
      .all(companyId)
      .map(mapUserContract);

    const timeEntries = db
      .prepare(
        `SELECT
          id,
          user_id,
          entry_type,
          entry_date,
          end_date,
          start_time,
          end_time,
          notes,
          sick_leave_attachment_name,
          sick_leave_attachment_mime_type,
          sick_leave_attachment_data_url,
          custom_field_values_json,
          created_at
         FROM time_entries
         WHERE company_id = ?
         ORDER BY id ASC`
      )
      .all(companyId)
      .map(mapTimeEntry);

    const projects = db
      .prepare("SELECT id, name, description, is_active, created_at FROM projects WHERE company_id = ? ORDER BY id ASC")
      .all(companyId)
      .map(mapProject);

    const tasks = db
      .prepare("SELECT id, project_id, title, is_active, created_at FROM tasks WHERE company_id = ? ORDER BY id ASC")
      .all(companyId)
      .map(mapTask);

    const publicHolidayCache = db
      .prepare("SELECT country_code, year, payload_json, fetched_at FROM public_holiday_cache WHERE company_id = ? ORDER BY year ASC, country_code ASC")
      .all(companyId) as Array<{ country_code: string; year: number; payload_json: string; fetched_at: string }>;

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
