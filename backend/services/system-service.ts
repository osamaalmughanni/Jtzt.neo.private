import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { mapCompanyRecord } from "../db/mappers";
import type { AppDatabase, RuntimeConfig } from "../runtime/types";
import type { DeveloperAccessTokenRecord } from "../../shared/types/models";
import { signWorkspaceKeyToken, verifyWorkspaceKeyToken } from "../auth/jwt";

function normalizeTabletCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function hashTabletCode(code: string) {
  return crypto.createHash("sha256").update(normalizeTabletCode(code)).digest("hex");
}

function formatTabletCode(code: string) {
  const normalized = normalizeTabletCode(code);
  const chunks = normalized.match(/.{1,4}/g) ?? [normalized];
  return chunks.join("-");
}

function generateTabletCodeValue() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let index = 0; index < 12; index += 1) {
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
    const rows = await db.all("SELECT id, name, encryption_enabled, tablet_code_updated_at, created_at FROM companies ORDER BY created_at DESC");
    return rows.map(mapCompanyRecord);
  },

  async getCompanyById(db: AppDatabase, companyId: string) {
    const row = await db.first("SELECT id, name, encryption_enabled, tablet_code_updated_at, created_at FROM companies WHERE id = ?", [companyId]);
    return row ? mapCompanyRecord(row) : null;
  },

  async getCompanyByName(db: AppDatabase, companyName: string) {
    const row = await db.first("SELECT id, name, encryption_enabled, tablet_code_updated_at, created_at FROM companies WHERE lower(name) = lower(?)", [companyName]);
    return row ? mapCompanyRecord(row) : null;
  },

  async getCompanyByTabletCode(db: AppDatabase, code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length === 0) {
      return null;
    }

    const row = await db.first(
      "SELECT id, name, encryption_enabled, tablet_code_updated_at, created_at FROM companies WHERE tablet_code_value = ? OR tablet_code_hash = ?",
      [normalized, hashTabletCode(normalized)]
    );
    return row ? mapCompanyRecord(row) : null;
  },

  async getCompanySecurity(db: AppDatabase, companyName: string) {
    const row = await db.first(
      "SELECT name, encryption_enabled, encryption_kdf_algorithm, encryption_kdf_iterations, encryption_kdf_salt FROM companies WHERE lower(name) = lower(?)",
      [companyName]
    ) as
      | {
          name: string;
          encryption_enabled: number;
          encryption_kdf_algorithm: "pbkdf2-sha256" | null;
          encryption_kdf_iterations: number | null;
          encryption_kdf_salt: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      companyName: row.name,
      encryptionEnabled: Boolean(row.encryption_enabled),
      kdfAlgorithm: row.encryption_kdf_algorithm,
      kdfIterations: row.encryption_kdf_iterations,
      kdfSalt: row.encryption_kdf_salt
    };
  },

  async getTabletCodeStatus(db: AppDatabase, companyId: string) {
    const row = await db.first("SELECT tablet_code_value, tablet_code_hash, tablet_code_updated_at FROM companies WHERE id = ?", [companyId]) as
      | { tablet_code_value: string | null; tablet_code_hash: string | null; tablet_code_updated_at: string | null }
      | null;

    if (!row) {
      return null;
    }

    return {
      configured: Boolean(row.tablet_code_hash),
      code: row.tablet_code_value ?? null,
      updatedAt: row.tablet_code_updated_at ?? null
    };
  },

  async setTabletCode(db: AppDatabase, companyId: string, code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length === 0 || normalized.length > 24) {
      throw new HTTPException(400, { message: "Tablet code must contain at least 1 letter or number and at most 24" });
    }

    const updatedAt = new Date().toISOString();
    try {
      await db.run("UPDATE companies SET tablet_code_value = ?, tablet_code_hash = ?, tablet_code_updated_at = ? WHERE id = ?", [
        normalized,
        hashTabletCode(normalized),
        updatedAt,
        companyId
      ]);
    } catch (error) {
      if (error instanceof Error && (error.message.includes("idx_companies_tablet_code_value") || error.message.includes("UNIQUE constraint failed: companies.tablet_code_value"))) {
        throw new HTTPException(409, { message: "Tablet code is already used by another company" });
      }
      throw error;
    }

    return {
      code: normalized,
      tabletCode: {
        configured: true,
        code: normalized,
        updatedAt
      }
    };
  },

  async regenerateTabletCode(db: AppDatabase, companyId: string) {
    return systemService.setTabletCode(db, companyId, generateTabletCodeValue());
  }
  ,

  async listDeveloperAccessTokens(db: AppDatabase) {
    const rows = await db.all<{
      company_id: string;
      company_name: string;
      token_hint: string;
      created_at: string;
      rotated_at: string;
    }>(
      `SELECT developer_access_tokens.company_id, companies.name AS company_name, developer_access_tokens.token_hint, developer_access_tokens.created_at, developer_access_tokens.rotated_at
       FROM developer_access_tokens
       JOIN companies ON companies.id = developer_access_tokens.company_id
       ORDER BY companies.created_at DESC`
    );
    return rows.map(formatDeveloperAccessTokenRecord);
  },

  async getDeveloperAccessTokenStatus(db: AppDatabase, companyId: string) {
    const row = await db.first<{
      company_id: string;
      company_name: string;
      token_hint: string;
      created_at: string;
      rotated_at: string;
    }>(
      `SELECT developer_access_tokens.company_id, companies.name AS company_name, developer_access_tokens.token_hint, developer_access_tokens.created_at, developer_access_tokens.rotated_at
       FROM developer_access_tokens
       JOIN companies ON companies.id = developer_access_tokens.company_id
       WHERE developer_access_tokens.company_id = ?`,
      [companyId]
    );
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

    await db.run(
      `INSERT INTO developer_access_tokens (
        company_id,
        token_hash,
        token_hint,
        created_at,
        rotated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        token_hint = excluded.token_hint,
        rotated_at = excluded.rotated_at`,
      [companyId, tokenHash, tokenHint, now, now]
    );

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
    const row = await db.first<{ token_hash: string }>("SELECT token_hash FROM developer_access_tokens WHERE company_id = ?", [companyId]);
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
