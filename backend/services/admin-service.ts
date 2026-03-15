import fs from "node:fs";
import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type {
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DeleteCompanyInput
} from "../../shared/types/api";
import {
  closeCompanyDb,
  createCompanyDbPath,
  getCompanyDb,
  initializeCompanyDatabase,
  seedCompanyAdmin,
  seedDefaultProjects
} from "../db/company-db";
import { getSystemDb } from "../db/system-db";
import { systemService } from "./system-service";

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

    const databasePath = createCompanyDbPath(input.name);
    initializeCompanyDatabase(databasePath).close();

    const createdAt = new Date().toISOString();
    const result = getSystemDb()
      .prepare(
        `INSERT INTO companies (
          name,
          encryption_enabled,
          encryption_kdf_algorithm,
          encryption_kdf_iterations,
          encryption_kdf_salt,
          encryption_key_verifier,
          database_path,
          created_at
        ) VALUES (
          @name,
          @encryptionEnabled,
          @encryptionKdfAlgorithm,
          @encryptionKdfIterations,
          @encryptionKdfSalt,
          @encryptionKeyVerifier,
          @databasePath,
          @createdAt
        )`
      )
      .run({
        name: input.name.trim(),
        encryptionEnabled: input.encryptionEnabled ? 1 : 0,
        encryptionKdfAlgorithm: input.encryptionEnabled ? input.encryptionKdfAlgorithm ?? "pbkdf2-sha256" : null,
        encryptionKdfIterations: input.encryptionEnabled ? input.encryptionKdfIterations ?? null : null,
        encryptionKdfSalt: input.encryptionEnabled ? input.encryptionKdfSalt ?? null : null,
        encryptionKeyVerifier: input.encryptionEnabled ? input.encryptionKeyVerifier ?? null : null,
        databasePath,
        createdAt
      });

    seedCompanyAdmin(databasePath, {
      username: input.adminUsername.trim(),
      password: input.adminPassword,
      fullName: input.adminFullName.trim()
    });

    return systemService.getCompanyById(Number(result.lastInsertRowid));
  },

  deleteCompany(input: DeleteCompanyInput) {
    const company = systemService.getCompanyById(input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    getSystemDb().prepare("DELETE FROM companies WHERE id = ?").run(input.companyId);
    closeCompanyDb(company.databasePath);

    for (const filePath of [
      company.databasePath,
      `${company.databasePath}-shm`,
      `${company.databasePath}-wal`
    ]) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  },

  createCompanyAdmin(input: CreateCompanyAdminInput) {
    const company = systemService.getCompanyById(input.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    getCompanyDb(company.databasePath)
      .prepare(
        "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (@username, @fullName, @passwordHash, 'admin', @createdAt)"
      )
      .run({
        username: input.username.trim(),
        fullName: input.fullName.trim(),
        passwordHash: bcrypt.hashSync(input.password, 10),
        createdAt: new Date().toISOString()
      });
  },

  getSystemStats() {
    const companies = systemService.listCompanies();
    let totalUsers = 0;
    let activeTimers = 0;

    for (const company of companies) {
      const db = getCompanyDb(company.databasePath);
      totalUsers += (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
      activeTimers += (db.prepare("SELECT COUNT(*) as count FROM time_entries WHERE end_time IS NULL").get() as {
        count: number;
      }).count;
    }

    const adminCount = (getSystemDb().prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number }).count;

    return {
      companyCount: companies.length,
      adminCount,
      totalUsers,
      activeTimers
    };
  },

  getCompanyDatabaseDownload(companyId: number) {
    const company = systemService.getCompanyById(companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    return {
      company,
      filePath: company.databasePath
    };
  }
};
