import { getSystemDb } from "../db/system-db";
import { mapCompanyRecord } from "../db/mappers";

export const systemService = {
  listCompanies() {
    const rows = getSystemDb()
      .prepare("SELECT id, name, database_path, created_at FROM companies ORDER BY created_at DESC")
      .all();
    return rows.map(mapCompanyRecord);
  },

  getCompanyById(companyId: number) {
    const row = getSystemDb()
      .prepare("SELECT id, name, database_path, created_at FROM companies WHERE id = ?")
      .get(companyId);
    return row ? mapCompanyRecord(row) : null;
  },

  getCompanyByName(companyName: string) {
    const row = getSystemDb()
      .prepare("SELECT id, name, database_path, created_at FROM companies WHERE lower(name) = lower(?)")
      .get(companyName);
    return row ? mapCompanyRecord(row) : null;
  }
};
