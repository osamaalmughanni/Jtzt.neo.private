import crypto from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { companies, developerAccessTokens } from "../db/schema";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";
import type { DeveloperAccessTokenRecord } from "../../shared/types/models";
import { signWorkspaceKeyToken, verifyWorkspaceKeyToken } from "../auth/jwt";

function normalizeTabletCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function hashTabletCode(code: string) {
  return crypto.createHash("sha256").update(normalizeTabletCode(code)).digest("hex");
}

function formatTabletCode(code: string) {
  return normalizeTabletCode(code);
}

function generateTabletCodeValue() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return formatTabletCode(value);
}

function hashDeveloperAccessToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function formatDeveloperAccessTokenRecord(row: {
  company_id: string;
  company_name: string;
  token_hint: string;
  created_at: string;
  rotated_at: string;
}): DeveloperAccessTokenRecord {
  return {
    companyId: row.company_id,
    companyName: row.company_name,
    tokenHint: row.token_hint,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at
  };
}

export const systemService = {
  async listCompanies(db: AppDatabase) {
    const rows = await db.orm.select({
      id: companies.id,
      name: companies.name,
      tabletCodeUpdatedAt: companies.tabletCodeUpdatedAt,
      createdAt: companies.createdAt,
    }).from(companies).orderBy(desc(companies.createdAt));
    return rows;
  },

  async getCompanyById(db: AppDatabase, companyId: string) {
    const row = await db.orm.select({
      id: companies.id,
      name: companies.name,
      tabletCodeUpdatedAt: companies.tabletCodeUpdatedAt,
      createdAt: companies.createdAt,
    }).from(companies).where(eq(companies.id, companyId)).get();
    return row ?? null;
  },

  async getCompanyByName(db: AppDatabase, companyName: string) {
    const row = await db.orm.select({
      id: companies.id,
      name: companies.name,
      tabletCodeUpdatedAt: companies.tabletCodeUpdatedAt,
      createdAt: companies.createdAt,
    }).from(companies).where(sql`lower(${companies.name}) = lower(${companyName})`).get();
    return row ?? null;
  },

  async getCompanyByTabletCode(db: AppDatabase, code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length === 0) {
      return null;
    }

    const row = await db.orm.select({
      id: companies.id,
      name: companies.name,
      tabletCodeUpdatedAt: companies.tabletCodeUpdatedAt,
      createdAt: companies.createdAt,
    }).from(companies).where(
      or(
        eq(companies.tabletCodeValue, normalized),
        eq(companies.tabletCodeHash, hashTabletCode(normalized)),
      ),
    ).get();
    return row ?? null;
  },

  async getTabletCodeStatus(db: AppDatabase, companyId: string) {
    const row = await db.orm.select({
      tabletCodeValue: companies.tabletCodeValue,
      tabletCodeHash: companies.tabletCodeHash,
      tabletCodeUpdatedAt: companies.tabletCodeUpdatedAt,
    }).from(companies).where(eq(companies.id, companyId)).get();

    if (!row) {
      return null;
    }

    return {
      configured: Boolean(row.tabletCodeHash),
      code: row.tabletCodeValue ? normalizeTabletCode(row.tabletCodeValue) : null,
      updatedAt: row.tabletCodeUpdatedAt ?? null
    };
  },

  async setTabletCode(db: AppDatabase, companyId: string, code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length > 24) {
      throw new HTTPException(400, { message: "Tablet code must contain at most 24 letters or numbers" });
    }

    const updatedAt = normalized.length > 0 ? new Date().toISOString() : null;
    try {
      await db.orm.update(companies).set({
        tabletCodeValue: normalized.length > 0 ? normalized : null,
        tabletCodeHash: normalized.length > 0 ? hashTabletCode(normalized) : null,
        tabletCodeUpdatedAt: updatedAt,
      }).where(eq(companies.id, companyId)).run();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("idx_companies_tablet_code_value") || error.message.includes("UNIQUE constraint failed: companies.tablet_code_value"))) {
        throw new HTTPException(409, { message: "Tablet code is already used by another company" });
      }
      throw error;
    }

    return {
      code: normalized,
      tabletCode: {
        configured: normalized.length > 0,
        code: normalized.length > 0 ? normalized : null,
        updatedAt
      }
    };
  },

  async regenerateTabletCode(db: AppDatabase, companyId: string) {
    return systemService.setTabletCode(db, companyId, generateTabletCodeValue());
  }
  ,

  async listDeveloperAccessTokens(db: AppDatabase) {
    const rows = await db.orm.select({
      company_id: developerAccessTokens.companyId,
      company_name: companies.name,
      token_hint: developerAccessTokens.tokenHint,
      created_at: developerAccessTokens.createdAt,
      rotated_at: developerAccessTokens.rotatedAt,
    }).from(developerAccessTokens)
      .innerJoin(companies, eq(companies.id, developerAccessTokens.companyId))
      .orderBy(desc(companies.createdAt));
    return rows.map(formatDeveloperAccessTokenRecord);
  },

  async getDeveloperAccessTokenStatus(db: AppDatabase, companyId: string) {
    const row = await db.orm.select({
      company_id: developerAccessTokens.companyId,
      company_name: companies.name,
      token_hint: developerAccessTokens.tokenHint,
      created_at: developerAccessTokens.createdAt,
      rotated_at: developerAccessTokens.rotatedAt,
    }).from(developerAccessTokens)
      .innerJoin(companies, eq(companies.id, developerAccessTokens.companyId))
      .where(eq(developerAccessTokens.companyId, companyId))
      .get();
    return row ? formatDeveloperAccessTokenRecord(row) : null;
  },

  async rotateDeveloperAccessToken(db: AppDatabase, config: RuntimeConfig, companyId: string) {
    const company = await systemService.getCompanyById(db, companyId);
    if (!company) {
      throw new HTTPException(404, { message: "Company not found" });
    }

    const token = await signWorkspaceKeyToken(config, {
      tokenType: "workspace_key",
      companyId: company.id,
      companyName: company.name,
      issuedAt: new Date().toISOString()
    });
    const tokenHash = hashDeveloperAccessToken(token);
    const now = new Date().toISOString();
    const tokenHint = token.slice(-6);

    await db.orm.insert(developerAccessTokens).values({
      companyId,
      tokenHash,
      tokenHint,
      createdAt: now,
      rotatedAt: now,
    }).onConflictDoUpdate({
      target: developerAccessTokens.companyId,
      set: {
        tokenHash,
        tokenHint,
        rotatedAt: now,
      },
    }).run();

    return {
      token,
      developerAccessToken: {
        companyId: company.id,
        companyName: company.name,
        tokenHint,
        createdAt: now,
        rotatedAt: now
      }
    };
  },

  async verifyDeveloperAccessToken(db: AppDatabase, config: RuntimeConfig, companyId: string, token: string) {
    const row = await db.orm.select({ token_hash: developerAccessTokens.tokenHash })
      .from(developerAccessTokens)
      .where(eq(developerAccessTokens.companyId, companyId))
      .get();
    if (!row) {
      return false;
    }

    try {
      const payload = await verifyWorkspaceKeyToken(config, token);
      return payload.companyId === companyId && row.token_hash === hashDeveloperAccessToken(token);
    } catch {
      return false;
    }
  }
};
