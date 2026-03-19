import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { CreateUserInput, UpdateUserInput, UserContractInput } from "../../shared/types/api";
import { mapCompanyUserDetail, mapCompanyUserListItem, mapUserContract } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function ensureAdminRoleWillRemainAsync(
  db: AppDatabase,
  companyId: string,
  userId: number,
  nextRole?: "employee" | "manager" | "admin"
) {
  const target = await db.first("SELECT role FROM users WHERE company_id = ? AND id = ?", [companyId, userId]) as
    | { role: "employee" | "manager" | "admin" }
    | null;
  if (!target) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const effectiveRole = nextRole ?? target.role;
  if (target.role !== "admin" || effectiveRole === "admin") {
    return;
  }

  const adminCountRow = await db.first("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND role = 'admin'", [companyId]) as { count: number } | null;
  if ((adminCountRow?.count ?? 0) <= 1) {
    throw new HTTPException(400, { message: "At least one admin is required" });
  }
}

async function ensureUniquePin(db: AppDatabase, companyId: string, pinCode: string, userId?: number) {
  const existing = userId
    ? await db.first("SELECT id FROM users WHERE company_id = ? AND pin_code = ? AND id != ?", [companyId, pinCode, userId])
    : await db.first("SELECT id FROM users WHERE company_id = ? AND pin_code = ?", [companyId, pinCode]);

  if (existing) {
    throw new HTTPException(409, { message: "PIN code already exists" });
  }
}

function validateContracts(contracts: UserContractInput[], todayDay: string) {
  if (contracts.length > 100) {
    throw new HTTPException(400, { message: "A user can have at most 100 contracts" });
  }

  const sorted = [...contracts].sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (let index = 0; index < sorted.length; index += 1) {
    const contract = sorted[index];
    if (contract.endDate !== null && contract.startDate > contract.endDate) {
      throw new HTTPException(400, { message: "Contract end date must be after the start date" });
    }

    if (contract.hoursPerWeek < 0 || contract.paymentPerHour < 0) {
      throw new HTTPException(400, { message: "Contract values cannot be negative" });
    }

    const previous = sorted[index - 1];
    const previousEndDate = previous?.endDate ?? "9999-12-31";
    if (previous && contract.startDate <= previousEndDate) {
      throw new HTTPException(400, { message: "Contracts cannot overlap" });
    }
  }

  const hasCurrentContract = sorted.some(
    (contract) => contract.startDate <= todayDay && (contract.endDate === null || contract.endDate >= todayDay)
  );

  if (!hasCurrentContract) {
    throw new HTTPException(400, { message: "A current active contract is required" });
  }
}

async function saveContracts(db: AppDatabase, companyId: string, userId: number, contracts: UserContractInput[], todayDay: string) {
  validateContracts(contracts, todayDay);
  const statements = [
    { sql: "DELETE FROM user_contracts WHERE company_id = ? AND user_id = ?", params: [companyId, userId] as const },
    ...contracts.map((contract) => ({
      sql: `INSERT INTO user_contracts (
        company_id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [companyId, userId, contract.hoursPerWeek, contract.startDate, contract.endDate, contract.paymentPerHour, new Date().toISOString()]
    }))
  ];
  await db.batch(statements.map((statement) => ({ sql: statement.sql, params: [...statement.params] })));
}

export const userService = {
  async listUsers(db: AppDatabase, companyId: string) {
    const rows = await db.all("SELECT id, full_name, is_active FROM users WHERE company_id = ? ORDER BY full_name COLLATE NOCASE ASC", [companyId]);
    return rows.map(mapCompanyUserListItem);
  },

  async getUser(db: AppDatabase, companyId: string, userId: number) {
    const row = await db.first(
      `SELECT
        id,
        username,
        full_name,
        is_active,
        role,
        pin_code,
        email,
        created_at
      FROM users
      WHERE company_id = ? AND id = ?`,
      [companyId, userId]
    );

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const contracts = await this.listUserContracts(db, companyId, userId);

    return mapCompanyUserDetail(row, contracts);
  },

  async listUserContracts(db: AppDatabase, companyId: string, userId: number) {
    return (await db.all(
      `SELECT
        id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        created_at
      FROM user_contracts
      WHERE company_id = ? AND user_id = ?
      ORDER BY start_date ASC`,
      [companyId, userId]
    )).map(mapUserContract);
  },

  async createUser(db: AppDatabase, companyId: string, input: CreateUserInput, todayDay: string) {
    const existing = await db.first("SELECT id FROM users WHERE company_id = ? AND username = ?", [companyId, input.username.trim()]);
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    await ensureUniquePin(db, companyId, input.pinCode);
    validateContracts(input.contracts, todayDay);

    const result = await db.run(
      `INSERT INTO users (
        company_id,
        username,
        full_name,
        password_hash,
        role,
        is_active,
        pin_code,
        email,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.username.trim(),
        input.fullName.trim(),
        bcrypt.hashSync(input.password, 10),
        input.role,
        input.isActive ? 1 : 0,
        input.pinCode,
        normalizeOptionalText(input.email),
        new Date().toISOString()
      ]
    );

    const userId = Number(result.lastRowId);
    await saveContracts(db, companyId, userId, input.contracts, todayDay);
    return userId;
  },

  async updateUser(db: AppDatabase, companyId: string, input: UpdateUserInput, todayDay: string) {
    const existing = await db.first("SELECT id FROM users WHERE company_id = ? AND id = ?", [companyId, input.userId]);
    if (!existing) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const duplicateUsername = await db.first("SELECT id FROM users WHERE company_id = ? AND username = ? AND id != ?", [
      companyId,
      input.username.trim(),
      input.userId
    ]);
    if (duplicateUsername) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    await ensureAdminRoleWillRemainAsync(db, companyId, input.userId, input.role);
    await ensureUniquePin(db, companyId, input.pinCode, input.userId);
    validateContracts(input.contracts, todayDay);

    const passwordHash =
      input.password && input.password.trim().length > 0
        ? bcrypt.hashSync(input.password, 10)
        : (
            await db.first("SELECT password_hash FROM users WHERE company_id = ? AND id = ?", [companyId, input.userId]) as { password_hash: string }
          ).password_hash;

    await db.run(
      `UPDATE users
       SET
         username = ?,
         full_name = ?,
         password_hash = ?,
         role = ?,
         is_active = ?,
         pin_code = ?,
         email = ?
       WHERE company_id = ? AND id = ?`,
      [
        input.username.trim(),
        input.fullName.trim(),
        passwordHash,
        input.role,
        input.isActive ? 1 : 0,
        input.pinCode,
        normalizeOptionalText(input.email),
        companyId,
        input.userId
      ]
    );

    await saveContracts(db, companyId, input.userId, input.contracts, todayDay);
  },

  async deleteUser(db: AppDatabase, companyId: string, userId: number) {
    await ensureAdminRoleWillRemainAsync(db, companyId, userId);
    await db.run("DELETE FROM user_contracts WHERE company_id = ? AND user_id = ?", [companyId, userId]);
    const result = await db.run("DELETE FROM users WHERE company_id = ? AND id = ?", [companyId, userId]);
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "User not found" });
    }
  }
};
