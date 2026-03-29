import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
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
import { invitationCodes, users } from "../db/schema";

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
    tabletCodeUpdatedAt?: string | null;
  };

async function createCompanySession(
  systemDb: AppDatabase,
  config: RuntimeConfig,
  companyId: string,
  session: CompanySessionInput,
) {
  const company = await systemService.getCompanyById(systemDb, companyId);
  if (!company) {
    throw new HTTPException(401, { message: "Invalid or expired bearer token" });
  }

  return signSessionToken(config, {
    actorType: "company_user",
    accessMode: session.accessMode,
    companyId: company.id,
    companyName: company.name,
    tabletCodeUpdatedAt: session.tabletCodeUpdatedAt ?? null,
    userId: session.userId,
    role: session.role,
  });
}

async function createWorkspaceSession(
  systemDb: AppDatabase,
  config: RuntimeConfig,
  companyId: string,
) {
  const company = await systemService.getCompanyById(systemDb, companyId);
  if (!company) {
    throw new HTTPException(401, { message: "Invalid or expired bearer token" });
  }

  return signSessionToken(config, {
    actorType: "workspace",
    accessMode: "full",
    companyId: company.id,
    companyName: company.name,
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
    const invitationRow = await systemDb.orm.select({ id: invitationCodes.id })
      .from(invitationCodes)
      .where(and(eq(invitationCodes.code, invitationCode), isNull(invitationCodes.usedAt)))
      .get();

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

    await systemDb.orm.update(invitationCodes).set({
      usedAt: new Date().toISOString(),
      usedByCompanyId: company.id,
    }).where(eq(invitationCodes.id, invitationRow.id)).run();

    const userRow = await companyDb.orm.select({
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
    }).from(users).where(and(eq(users.username, input.adminUsername), isNull(users.deletedAt))).get();

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

    const userRow = await companyDb.orm.select({
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
    }).from(users).where(and(eq(users.username, input.username), isNull(users.deletedAt))).get();

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

    const userRow = await companyDb.orm.select({
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
    }).from(users).where(and(eq(users.pinCode, input.pinCode.trim()), isNull(users.deletedAt))).get() as Record<string, unknown> | null;

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
      tabletCodeUpdatedAt: company.tabletCodeUpdatedAt,
    });
  },

  async getCompanySessionDetails(systemDb: AppDatabase, companyDb: AppDatabase, payload: { companyId: string; userId: number; accessMode: "full" | "tablet" }) {
    const company = await systemService.getCompanyById(systemDb, payload.companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const row = await companyDb.orm.select({
      id: users.id,
      username: users.username,
      full_name: users.fullName,
      role: users.role,
    }).from(users).where(and(eq(users.id, payload.userId), isNull(users.deletedAt))).get();

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
