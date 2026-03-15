import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { CreateUserInput, UpdateUserInput, UserContractInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapCompanyUserDetail, mapCompanyUserListItem, mapUserContract } from "../db/mappers";

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function ensureAdminRoleWillRemain(db: ReturnType<typeof getCompanyDb>, userId: number, nextRole?: "employee" | "manager" | "admin") {
  const target = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: "employee" | "manager" | "admin" } | undefined;
  if (!target) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const effectiveRole = nextRole ?? target.role;
  if (target.role !== "admin" || effectiveRole === "admin") {
    return;
  }

  const adminCountRow = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number };
  if (adminCountRow.count <= 1) {
    throw new HTTPException(400, { message: "At least one admin is required" });
  }
}

function ensureUniquePin(db: ReturnType<typeof getCompanyDb>, pinCode: string, userId?: number) {
  const existing = userId
    ? db.prepare("SELECT id FROM users WHERE pin_code = ? AND id != ?").get(pinCode, userId)
    : db.prepare("SELECT id FROM users WHERE pin_code = ?").get(pinCode);

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

function saveContracts(
  db: ReturnType<typeof getCompanyDb>,
  userId: number,
  contracts: UserContractInput[],
  todayDay: string,
) {
  validateContracts(contracts, todayDay);
  db.prepare("DELETE FROM user_contracts WHERE user_id = ?").run(userId);

  const insertContract = db.prepare(
    `INSERT INTO user_contracts (
      user_id,
      hours_per_week,
      start_date,
      end_date,
      payment_per_hour,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const contract of contracts) {
    insertContract.run(
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
  listUsers(databasePath: string) {
    const rows = getCompanyDb(databasePath)
      .prepare("SELECT id, full_name, is_active FROM users ORDER BY full_name COLLATE NOCASE ASC")
      .all();
    return rows.map(mapCompanyUserListItem);
  },

  getUser(databasePath: string, userId: number) {
    const db = getCompanyDb(databasePath);
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
        WHERE id = ?`
      )
      .get(userId);

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const contracts = this.listUserContracts(databasePath, userId);

    return mapCompanyUserDetail(row, contracts);
  },

  listUserContracts(databasePath: string, userId: number) {
    return getCompanyDb(databasePath)
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
        WHERE user_id = ?
        ORDER BY start_date ASC`
      )
      .all(userId)
      .map(mapUserContract);
  },

  createUser(databasePath: string, input: CreateUserInput, todayDay: string) {
    const db = getCompanyDb(databasePath);
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(input.username.trim());
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    ensureUniquePin(db, input.pinCode);
    validateContracts(input.contracts, todayDay);

    const result = db.prepare(
      `INSERT INTO users (
        username,
        full_name,
        password_hash,
        role,
        is_active,
        pin_code,
        email,
        created_at
      ) VALUES (
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
    saveContracts(db, userId, input.contracts, todayDay);
    return userId;
  },

  updateUser(databasePath: string, input: UpdateUserInput, todayDay: string) {
    const db = getCompanyDb(databasePath);
    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(input.userId);
    if (!existing) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const duplicateUsername = db
      .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .get(input.username.trim(), input.userId);
    if (duplicateUsername) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    ensureAdminRoleWillRemain(db, input.userId, input.role);
    ensureUniquePin(db, input.pinCode, input.userId);
    validateContracts(input.contracts, todayDay);

    const passwordHash =
      input.password && input.password.trim().length > 0
        ? bcrypt.hashSync(input.password, 10)
        : (
            db.prepare("SELECT password_hash FROM users WHERE id = ?").get(input.userId) as { password_hash: string }
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
      WHERE id = @userId`
    ).run({
      userId: input.userId,
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash,
      role: input.role,
      isActive: input.isActive ? 1 : 0,
      pinCode: input.pinCode,
      email: normalizeOptionalText(input.email)
    });

    saveContracts(db, input.userId, input.contracts, todayDay);
  },

  deleteUser(databasePath: string, userId: number) {
    const db = getCompanyDb(databasePath);
    ensureAdminRoleWillRemain(db, userId);
    db.prepare("DELETE FROM user_contracts WHERE user_id = ?").run(userId);
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "User not found" });
    }
  }
};
