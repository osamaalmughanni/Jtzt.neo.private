import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { CreateUserInput, UpdateUserInput, UserContractInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapCompanyUserDetail, mapCompanyUserListItem, mapUserContract } from "../db/mappers";

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function ensureAdminRoleWillRemain(
  db: ReturnType<typeof getCompanyDb>,
  companyId: string,
  userId: number,
  nextRole?: "employee" | "manager" | "admin"
) {
  const target = db.prepare("SELECT role FROM users WHERE company_id = ? AND id = ?").get(companyId, userId) as
    | { role: "employee" | "manager" | "admin" }
    | undefined;
  if (!target) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const effectiveRole = nextRole ?? target.role;
  if (target.role !== "admin" || effectiveRole === "admin") {
    return;
  }

  const adminCountRow = db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND role = 'admin'").get(companyId) as { count: number };
  if (adminCountRow.count <= 1) {
    throw new HTTPException(400, { message: "At least one admin is required" });
  }
}

function ensureUniquePin(db: ReturnType<typeof getCompanyDb>, companyId: string, pinCode: string, userId?: number) {
  const existing = userId
    ? db.prepare("SELECT id FROM users WHERE company_id = ? AND pin_code = ? AND id != ?").get(companyId, pinCode, userId)
    : db.prepare("SELECT id FROM users WHERE company_id = ? AND pin_code = ?").get(companyId, pinCode);

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

function saveContracts(db: ReturnType<typeof getCompanyDb>, companyId: string, userId: number, contracts: UserContractInput[], todayDay: string) {
  validateContracts(contracts, todayDay);
  db.prepare("DELETE FROM user_contracts WHERE company_id = ? AND user_id = ?").run(companyId, userId);

  const insertContract = db.prepare(
    `INSERT INTO user_contracts (
      company_id,
      user_id,
      hours_per_week,
      start_date,
      end_date,
      payment_per_hour,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const contract of contracts) {
    insertContract.run(
      companyId,
      userId,
      contract.hoursPerWeek,
      contract.startDate,
      contract.endDate,
      contract.paymentPerHour,
      new Date().toISOString()
    );
  }
}

export const userService = {
  listUsers(companyId: string) {
    const rows = getCompanyDb(companyId)
      .prepare("SELECT id, full_name, is_active FROM users WHERE company_id = ? ORDER BY full_name COLLATE NOCASE ASC")
      .all(companyId);
    return rows.map(mapCompanyUserListItem);
  },

  getUser(companyId: string, userId: number) {
    const db = getCompanyDb(companyId);
    const row = db
      .prepare(
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
        WHERE company_id = ? AND id = ?`
      )
      .get(companyId, userId);

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const contracts = this.listUserContracts(companyId, userId);

    return mapCompanyUserDetail(row, contracts);
  },

  listUserContracts(companyId: string, userId: number) {
    return getCompanyDb(companyId)
      .prepare(
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
        ORDER BY start_date ASC`
      )
      .all(companyId, userId)
      .map(mapUserContract);
  },

  createUser(companyId: string, input: CreateUserInput, todayDay: string) {
    const db = getCompanyDb(companyId);
    const existing = db.prepare("SELECT id FROM users WHERE company_id = ? AND username = ?").get(companyId, input.username.trim());
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    ensureUniquePin(db, companyId, input.pinCode);
    validateContracts(input.contracts, todayDay);

    const result = db.prepare(
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
      ) VALUES (
        @companyId,
        @username,
        @fullName,
        @passwordHash,
        @role,
        @isActive,
        @pinCode,
        @email,
        @createdAt
      )`
    ).run({
      companyId,
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: input.role,
      isActive: input.isActive ? 1 : 0,
      pinCode: input.pinCode,
      email: normalizeOptionalText(input.email),
      createdAt: new Date().toISOString()
    });

    const userId = Number(result.lastInsertRowid);
    saveContracts(db, companyId, userId, input.contracts, todayDay);
    return userId;
  },

  updateUser(companyId: string, input: UpdateUserInput, todayDay: string) {
    const db = getCompanyDb(companyId);
    const existing = db.prepare("SELECT id FROM users WHERE company_id = ? AND id = ?").get(companyId, input.userId);
    if (!existing) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const duplicateUsername = db
      .prepare("SELECT id FROM users WHERE company_id = ? AND username = ? AND id != ?")
      .get(companyId, input.username.trim(), input.userId);
    if (duplicateUsername) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    ensureAdminRoleWillRemain(db, companyId, input.userId, input.role);
    ensureUniquePin(db, companyId, input.pinCode, input.userId);
    validateContracts(input.contracts, todayDay);

    const passwordHash =
      input.password && input.password.trim().length > 0
        ? bcrypt.hashSync(input.password, 10)
        : (
            db.prepare("SELECT password_hash FROM users WHERE company_id = ? AND id = ?").get(companyId, input.userId) as { password_hash: string }
          ).password_hash;

    db.prepare(
      `UPDATE users
      SET
        username = @username,
        full_name = @fullName,
        password_hash = @passwordHash,
        role = @role,
        is_active = @isActive,
        pin_code = @pinCode,
        email = @email
      WHERE company_id = @companyId AND id = @userId`
    ).run({
      companyId,
      userId: input.userId,
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash,
      role: input.role,
      isActive: input.isActive ? 1 : 0,
      pinCode: input.pinCode,
      email: normalizeOptionalText(input.email)
    });

    saveContracts(db, companyId, input.userId, input.contracts, todayDay);
  },

  deleteUser(companyId: string, userId: number) {
    const db = getCompanyDb(companyId);
    ensureAdminRoleWillRemain(db, companyId, userId);
    db.prepare("DELETE FROM user_contracts WHERE company_id = ? AND user_id = ?").run(companyId, userId);
    const result = db.prepare("DELETE FROM users WHERE company_id = ? AND id = ?").run(companyId, userId);
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "User not found" });
    }
  }
};
