import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type {
  AdminLoginInput,
  CompanyLoginInput,
  RegisterCompanyInput,
  TabletAccessInput,
  TabletLoginInput
} from "../../shared/types/api";
import { mapCompanyUserProfile, mapCompanyUser } from "../db/mappers";
import { signSessionToken } from "../auth/jwt";
import { systemService } from "./system-service";
import { adminService } from "./admin-service";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";

function normalizeProof(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function compareProofs(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeInvitationCode(value: string) {
  return value.trim().toUpperCase();
}

export const authService = {
  async loginAdmin(db: AppDatabase, config: RuntimeConfig, input: AdminLoginInput) {
    const expectedToken = config.adminAccessToken.trim();
    const providedToken = input.token.trim();
    if (!expectedToken || !providedToken || !compareProofs(expectedToken, providedToken)) {
      throw new HTTPException(401, { message: "Invalid admin token" });
    }

    return signSessionToken(config, {
      actorType: "admin",
      adminId: 1,
      username: "admin"
    });
  },

  async registerCompany(db: AppDatabase, config: RuntimeConfig, input: RegisterCompanyInput) {
    if (input.encryptionEnabled) {
      if (!input.encryptionKdfSalt || !input.encryptionKdfIterations || !input.encryptionKeyVerifier) {
        throw new HTTPException(400, { message: "Secure mode requires client-side encryption metadata" });
      }
    }

    const invitationCode = normalizeInvitationCode(input.invitationCode);
    const invitationRow = await db.first(
      `SELECT id
       FROM invitation_codes
       WHERE code = ?
         AND used_at IS NULL`,
      [invitationCode]
    ) as { id: number } | null;

    if (!invitationRow) {
      throw new HTTPException(403, { message: "Invitation code is invalid or already used" });
    }

    const company = await adminService.createCompany(db, {
      name: input.name,
      adminUsername: input.adminUsername,
      adminPassword: input.adminPassword,
      adminFullName: input.adminFullName?.trim() || input.adminUsername.trim(),
      encryptionEnabled: input.encryptionEnabled,
      encryptionKdfAlgorithm: input.encryptionEnabled ? input.encryptionKdfAlgorithm ?? "pbkdf2-sha256" : undefined,
      encryptionKdfIterations: input.encryptionEnabled ? input.encryptionKdfIterations : undefined,
      encryptionKdfSalt: input.encryptionEnabled ? input.encryptionKdfSalt : undefined,
      encryptionKeyVerifier: input.encryptionEnabled ? normalizeProof(input.encryptionKeyVerifier) : undefined
    });
    if (!company) {
      throw new HTTPException(500, { message: "Company could not be created" });
    }

    await db.run(
      "UPDATE invitation_codes SET used_at = ?, used_by_company_id = ? WHERE id = ?",
      [new Date().toISOString(), company.id, invitationRow.id]
    );

    const userRow = await db.first(
      "SELECT id, username, full_name, password_hash, role, is_active, pin_code, created_at FROM users WHERE company_id = ? AND username = ?",
      [company.id, input.adminUsername]
    );

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user) {
      throw new HTTPException(500, { message: "Company admin could not be provisioned" });
    }

    return signSessionToken(config, {
      actorType: "company_user",
      accessMode: "full",
      companyId: company.id,
      companyName: company.name,
      userId: user.id,
      role: user.role
    });
  },

  async loginCompanyUser(db: AppDatabase, config: RuntimeConfig, input: CompanyLoginInput) {
    const company = await systemService.getCompanyByName(db, input.companyName);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }

    if (company.encryptionEnabled) {
      const security = await db.first("SELECT encryption_key_verifier FROM companies WHERE id = ?", [company.id]) as
        | { encryption_key_verifier: string | null }
        | null;

      const providedProof = normalizeProof(input.encryptionKeyProof);
      const expectedProof = normalizeProof(security?.encryption_key_verifier ?? "");

      if (!providedProof || !expectedProof || !compareProofs(expectedProof, providedProof)) {
        throw new HTTPException(401, { message: "Invalid encryption key" });
      }
    }

    const userRow = await db.first(
      "SELECT id, username, full_name, password_hash, role, is_active, pin_code, created_at FROM users WHERE company_id = ? AND username = ?",
      [company.id, input.username]
    );

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user || !bcrypt.compareSync(input.password, user.passwordHash)) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }
    if (!user.isActive) {
      throw new HTTPException(403, { message: "User is inactive" });
    }

    return signSessionToken(config, {
      actorType: "company_user",
      accessMode: "full",
      companyId: company.id,
      companyName: company.name,
      userId: user.id,
      role: user.role
    });
  },

  async getTabletAccess(db: AppDatabase, input: TabletAccessInput) {
    const company = await systemService.getCompanyByTabletCode(db, input.code);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid tablet code" });
    }

    const security = await systemService.getCompanySecurity(db, company.name);

    return {
      companyName: company.name,
      encryptionEnabled: Boolean(security?.encryptionEnabled),
      kdfAlgorithm: security?.kdfAlgorithm ?? null,
      kdfIterations: security?.kdfIterations ?? null,
      kdfSalt: security?.kdfSalt ?? null
    };
  },

  async loginTabletUser(db: AppDatabase, config: RuntimeConfig, input: TabletLoginInput) {
    const company = await systemService.getCompanyByTabletCode(db, input.code);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid tablet code" });
    }

    const userRow = await db.first(
      "SELECT id, username, full_name, password_hash, role, is_active, pin_code, created_at FROM users WHERE company_id = ? AND pin_code = ?",
      [company.id, input.pinCode.trim()]
    ) as Record<string, unknown> | null;

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user) {
      throw new HTTPException(401, { message: "Invalid PIN code" });
    }
    if (!user.isActive) {
      throw new HTTPException(403, { message: "User is inactive" });
    }

    return signSessionToken(config, {
      actorType: "company_user",
      accessMode: "tablet",
      companyId: company.id,
      companyName: company.name,
      userId: user.id,
      role: user.role
    });
  },

  async getCompanySecurity(db: AppDatabase, companyName: string) {
    const companySecurity = await systemService.getCompanySecurity(db, companyName);
    if (!companySecurity) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    return companySecurity;
  },

  async getCompanySessionDetails(db: AppDatabase, payload: { companyId: string; userId: number; accessMode: "full" | "tablet" }) {
    const company = await systemService.getCompanyById(db, payload.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const row = await db.first("SELECT id, username, full_name, role FROM users WHERE company_id = ? AND id = ?", [
      payload.companyId,
      payload.userId
    ]);

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    return {
      company,
      user: mapCompanyUserProfile(row),
      accessMode: payload.accessMode
    };
  }
};
