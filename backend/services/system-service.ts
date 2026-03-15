import { getSystemDb } from "../db/system-db";
import { mapCompanyRecord } from "../db/mappers";

export const systemService = {
  listCompanies() {
    const rows = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, created_at FROM companies ORDER BY created_at DESC")
      .all();
    return rows.map(mapCompanyRecord);
  },

  getCompanyById(companyId: number) {
    const row = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, created_at FROM companies WHERE id = ?")
      .get(companyId);
    return row ? mapCompanyRecord(row) : null;
  },

  getCompanyByName(companyName: string) {
    const row = getSystemDb()
      .prepare("SELECT id, name, encryption_enabled, database_path, created_at FROM companies WHERE lower(name) = lower(?)")
      .get(companyName);
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
  }
};
