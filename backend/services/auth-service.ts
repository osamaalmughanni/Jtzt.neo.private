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
import { verifyWorkspaceKeyToken } from "../auth/jwt";
import { systemService } from "./system-service";
import { adminService } from "./admin-service";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";

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

function hashAdminAccessToken(value: string) {
  return crypto.createHash("sha256").update(value.trim()).digest("hex");
}

type CompanySessionInput =
  {
    accessMode: "full" | "tablet";
    userId: number;
    role: "employee" | "manager" | "admin";
  };

async function createCompanySession(
  systemDb: AppDatabase,
  config: RuntimeConfig,
  companyId: string,
  session: CompanySessionInput,
) {
  const company = await systemService.getCompanyAuthState(systemDb, companyId);
  if (!company) {
    throw new HTTPException(401, { message: "Invalid or expired bearer token" });
  }

  return signSessionToken(config, {
    actorType: "company_user",
    accessMode: session.accessMode,
    companyId: company.id,
    companyName: company.name,
    userId: session.userId,
    role: session.role,
  });
}

async function createWorkspaceSession(
  systemDb: AppDatabase,
  config: RuntimeConfig,
  companyId: string,
) {
  const company = await systemService.getCompanyAuthState(systemDb, companyId);
  if (!company) {
    throw new HTTPException(401, { message: "Invalid or expired bearer token" });
  }

  return signSessionToken(config, {
    actorType: "workspace",
    accessMode: "full",
    companyId: company.id,
    companyName: company.name,
    workspaceAuthVersion: company.authVersion,
    userId: 0,
    role: "admin",
  });
}

export const authService = {
  async loginAdmin(config: RuntimeConfig, input: AdminLoginInput) {
    const expectedToken = config.adminAccessToken.trim();
    const providedToken = input.token.trim();
    if (!expectedToken || !providedToken || !compareProofs(expectedToken, providedToken)) {
      throw new HTTPException(401, { message: "Invalid admin token" });
    }

    return await signSessionToken(config, {
      actorType: "admin",
      adminId: 1,
      username: "admin",
      adminAuthFingerprint: hashAdminAccessToken(config.adminAccessToken),
    });
  },

  async registerCompany(systemDb: AppDatabase, companyDb: AppDatabase, config: RuntimeConfig, input: RegisterCompanyInput, companyId: string) {
    const invitationCode = normalizeInvitationCode(input.invitationCode);
    const invitationRow = await systemDb.first(
      `SELECT id
       FROM invitation_codes
       WHERE code = ?
         AND used_at IS NULL`,
      [invitationCode]
    ) as { id: number } | null;

    if (!invitationRow) {
      throw new HTTPException(403, { message: "Invitation code is invalid or already used" });
    }

    const company = await adminService.createCompany(systemDb, companyDb, {
      name: input.name,
      adminUsername: input.adminUsername,
      adminPassword: input.adminPassword,
      adminFullName: input.adminFullName?.trim() || input.adminUsername.trim(),
    }, companyId);
    if (!company) {
      throw new HTTPException(500, { message: "Company could not be created" });
    }

    await systemDb.run(
      "UPDATE invitation_codes SET used_at = ?, used_by_company_id = ? WHERE id = ?",
      [new Date().toISOString(), company.id, invitationRow.id]
    );

    const userRow = await companyDb.first(
      "SELECT id, username, full_name, password_hash, role, is_active, deleted_at, pin_code, created_at FROM users WHERE username = ? AND deleted_at IS NULL",
      [input.adminUsername]
    );

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user) {
      throw new HTTPException(500, { message: "Company admin could not be provisioned" });
    }

    return await createCompanySession(systemDb, config, company.id, {
      accessMode: "full",
      userId: user.id,
      role: user.role,
    });
  },

  async loginCompanyUser(systemDb: AppDatabase, companyDb: AppDatabase, config: RuntimeConfig, input: CompanyLoginInput) {
    const company = await systemService.getCompanyByName(systemDb, input.companyName);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }

    const userRow = await companyDb.first(
      "SELECT id, username, full_name, password_hash, role, is_active, deleted_at, pin_code, created_at FROM users WHERE username = ? AND deleted_at IS NULL",
      [input.username]
    );

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user || !bcrypt.compareSync(input.password, user.passwordHash)) {
      throw new HTTPException(401, { message: "Invalid company credentials" });
    }
    if (!user.isActive) {
      throw new HTTPException(403, { message: "User is inactive" });
    }

    return await createCompanySession(systemDb, config, company.id, {
      accessMode: "full",
      userId: user.id,
      role: user.role,
    });
  },

  async loginWorkspaceKey(systemDb: AppDatabase, config: RuntimeConfig, input: { token: string }) {
    let payload;
    try {
      payload = await verifyWorkspaceKeyToken(config, input.token.trim());
    } catch {
      throw new HTTPException(401, { message: "Invalid workspace key" });
    }

    const company = await systemService.getCompanyById(systemDb, payload.companyId);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid workspace key" });
    }
    if (company.name !== payload.companyName) {
      throw new HTTPException(401, { message: "Invalid workspace key" });
    }

    const isValidToken = await systemService.verifyDeveloperAccessToken(systemDb, config, company.id, input.token.trim());
    if (!isValidToken) {
      throw new HTTPException(401, { message: "Invalid workspace key" });
    }

    return await createWorkspaceSession(systemDb, config, company.id);
  },

  async getTabletAccess(systemDb: AppDatabase, input: TabletAccessInput) {
    const company = await systemService.getCompanyByTabletCode(systemDb, input.code);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid tablet code" });
    }

    return {
      companyName: company.name,
    };
  },

  async loginTabletUser(systemDb: AppDatabase, companyDb: AppDatabase, config: RuntimeConfig, input: TabletLoginInput) {
    const company = await systemService.getCompanyByTabletCode(systemDb, input.code);
    if (!company) {
      throw new HTTPException(401, { message: "Invalid tablet code" });
    }

    const userRow = await companyDb.first(
      "SELECT id, username, full_name, password_hash, role, is_active, deleted_at, pin_code, created_at FROM users WHERE pin_code = ? AND deleted_at IS NULL",
      [input.pinCode.trim()]
    ) as Record<string, unknown> | null;

    const user = userRow ? mapCompanyUser(userRow) : null;
    if (!user) {
      throw new HTTPException(401, { message: "Invalid PIN code" });
    }
    if (!user.isActive) {
      throw new HTTPException(403, { message: "User is inactive" });
    }

    return await createCompanySession(systemDb, config, company.id, {
      accessMode: "tablet",
      userId: user.id,
      role: user.role,
    });
  },

  async getCompanySessionDetails(systemDb: AppDatabase, companyDb: AppDatabase, payload: { companyId: string; userId: number; accessMode: "full" | "tablet" }) {
    const company = await systemService.getCompanyById(systemDb, payload.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const row = await companyDb.first("SELECT id, username, full_name, role FROM users WHERE id = ? AND deleted_at IS NULL", [
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
