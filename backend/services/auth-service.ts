import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { AdminLoginInput, CompanyLoginInput } from "../../shared/types/api";
import { getSystemDb } from "../db/system-db";
import { getCompanyDb } from "../db/company-db";
import { mapCompanyUserProfile, mapCompanyUser } from "../db/mappers";
import { signSessionToken } from "../auth/jwt";
import { systemService } from "./system-service";

export const authService = {
  loginAdmin(input: AdminLoginInput) {
    const row = getSystemDb()
      .prepare("SELECT id, username, password_hash FROM admins WHERE username = ?")
      .get(input.username) as { id: number; username: string; password_hash: string } | undefined;

    if (!row || !bcrypt.compareSync(input.password, row.password_hash)) {
      throw new HTTPException(401, { message: "Invalid admin credentials" });
    }

    return signSessionToken({
      actorType: "admin",
      adminId: row.id,
      username: row.username
    });
  },

  loginCompanyUser(input: CompanyLoginInput) {
    const company = systemService.getCompanyByName(input.companyName);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }

    const userRow = getCompanyDb(company.databasePath)
      .prepare("SELECT id, username, full_name, password_hash, role, created_at FROM users WHERE username = ?")
      .get(input.username);

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user || !bcrypt.compareSync(input.password, user.passwordHash)) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }

    return signSessionToken({
      actorType: "company_user",
      companyId: company.id,
      companyName: company.name,
      databasePath: company.databasePath,
      userId: user.id,
      role: user.role
    });
  },

  getCompanySessionDetails(payload: { companyId: number; databasePath: string; userId: number }) {
    const company = systemService.getCompanyById(payload.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const row = getCompanyDb(payload.databasePath)
      .prepare("SELECT id, username, full_name, role FROM users WHERE id = ?")
      .get(payload.userId);

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    return {
      company,
      user: mapCompanyUserProfile(row)
    };
  }
};
