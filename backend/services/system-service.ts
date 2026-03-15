import { getSystemDb } from "../db/system-db";
import { mapCompanyRecord } from "../db/mappers";
import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";

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

export const systemService = {
  listCompanies() {
    const rows = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, tablet_code_updated_at, created_at FROM companies ORDER BY created_at DESC")
      .all();
    return rows.map(mapCompanyRecord);
  },

  getCompanyById(companyId: number) {
    const row = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, tablet_code_updated_at, created_at FROM companies WHERE id = ?")
      .get(companyId);
    return row ? mapCompanyRecord(row) : null;
  },

  getCompanyByName(companyName: string) {
    const row = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, tablet_code_updated_at, created_at FROM companies WHERE lower(name) = lower(?)")
      .get(companyName);
    return row ? mapCompanyRecord(row) : null;
  },

  getCompanyByTabletCode(code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length < 6) {
      return null;
    }

    const row = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, tablet_code_updated_at, created_at FROM companies WHERE tablet_code_hash = ?")
      .get(hashTabletCode(normalized));
    return row ? mapCompanyRecord(row) : null;
  },

  getCompanySecurity(companyName: string) {
    const row = getSystemDb()
      .prepare(
        "SELECT name, encryption_enabled, encryption_kdf_algorithm, encryption_kdf_iterations, encryption_kdf_salt FROM companies WHERE lower(name) = lower(?)"
      )
      .get(companyName) as
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

  getTabletCodeStatus(companyId: number) {
    const row = getSystemDb()
      .prepare("SELECT tablet_code_hash, tablet_code_updated_at FROM companies WHERE id = ?")
      .get(companyId) as { tablet_code_hash: string | null; tablet_code_updated_at: string | null } | undefined;

    if (!row) {
      return null;
    }

    return {
      configured: Boolean(row.tablet_code_hash),
      updatedAt: row.tablet_code_updated_at ?? null
    };
  },

  setTabletCode(companyId: number, code: string) {
    const normalized = normalizeTabletCode(code);
    if (normalized.length < 6 || normalized.length > 24) {
      throw new HTTPException(400, { message: "Tablet code must be between 6 and 24 letters or numbers" });
    }

    const formattedCode = formatTabletCode(normalized);
    const updatedAt = new Date().toISOString();
    getSystemDb()
      .prepare("UPDATE companies SET tablet_code_hash = ?, tablet_code_updated_at = ? WHERE id = ?")
      .run(hashTabletCode(formattedCode), updatedAt, companyId);

    return {
      code: formattedCode,
      tabletCode: {
        configured: true,
        updatedAt
      }
    };
  },

  regenerateTabletCode(companyId: number) {
    return systemService.setTabletCode(companyId, generateTabletCodeValue());
  }
};
