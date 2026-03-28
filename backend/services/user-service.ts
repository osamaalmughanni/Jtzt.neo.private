import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { CreateUserInput, UpdateUserInput, UserContractInput } from "../../shared/types/api";
import { mapCompanyUserDetail, mapCompanyUserListItem, mapUserContract, mapUserContractScheduleBlock } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";
import { buildContractInputWithDerivedHours } from "./user-contract-schedule";

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
  const target = await db.first("SELECT role FROM users WHERE id = ? AND deleted_at IS NULL", [userId]) as
    | { role: "employee" | "manager" | "admin" }
    | null;
  if (!target) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const effectiveRole = nextRole ?? target.role;
  if (target.role !== "admin" || effectiveRole === "admin") {
    return;
  }

  const adminCountRow = await db.first("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL") as { count: number } | null;
  if ((adminCountRow?.count ?? 0) <= 1) {
    throw new HTTPException(400, { message: "At least one admin is required" });
  }
}

async function ensureUniquePin(db: AppDatabase, companyId: string, pinCode: string, userId?: number) {
  const existing = userId
    ? await db.first("SELECT id FROM users WHERE pin_code = ? AND id != ? AND deleted_at IS NULL", [pinCode, userId])
    : await db.first("SELECT id FROM users WHERE pin_code = ? AND deleted_at IS NULL", [pinCode]);

  if (existing) {
    throw new HTTPException(409, { message: "PIN code already exists" });
  }
}

function validateContracts(contracts: UserContractInput[], todayDay: string) {
  if (contracts.length > 100) {
    throw new HTTPException(400, { message: "A user can have at most 100 contracts" });
  }

  const normalizedContracts = contracts.map((contract) =>
    buildContractInputWithDerivedHours(contract, (message) => {
      throw new HTTPException(400, { message });
    })
  );
  const sorted = [...normalizedContracts].sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (let index = 0; index < sorted.length; index += 1) {
    const contract = sorted[index];
    if (contract.endDate !== null && contract.startDate > contract.endDate) {
      throw new HTTPException(400, { message: "Contract end date must be after the start date" });
    }

    if (contract.paymentPerHour < 0) {
      throw new HTTPException(400, { message: "Contract values cannot be negative" });
    }
    if (contract.annualVacationDays < 0) {
      throw new HTTPException(400, { message: "Annual vacation days cannot be negative" });
    }

    if (!contract.schedule.some((day) => day.blocks.length > 0)) {
      throw new HTTPException(400, { message: "A working day is required" });
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

  return sorted;
}

async function saveContracts(db: AppDatabase, companyId: string, userId: number, contracts: UserContractInput[], todayDay: string) {
  const normalizedContracts = validateContracts(contracts, todayDay);
  const contractIds = await db.all<{ id: number }>("SELECT id FROM user_contracts WHERE user_id = ?", [userId]);
  const statements = [
    ...contractIds.map((row) => ({
      sql: "DELETE FROM user_contract_schedule_blocks WHERE contract_id = ?",
      params: [row.id] as const
    })),
    { sql: "DELETE FROM user_contracts WHERE user_id = ?", params: [userId] as const },
  ];
  await db.batch(statements.map((statement) => ({ sql: statement.sql, params: [...statement.params] })));

  for (const contract of normalizedContracts) {
    const createdAt = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO user_contracts (
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        annual_vacation_days,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, contract.hoursPerWeek, contract.startDate, contract.endDate, contract.paymentPerHour, contract.annualVacationDays, createdAt]
    );
    const contractId = Number(result.lastRowId);
    for (const day of contract.schedule) {
      for (const [blockIndex, block] of day.blocks.entries()) {
        await db.run(
          `INSERT INTO user_contract_schedule_blocks (
            contract_id,
            weekday,
            block_order,
            start_time,
            end_time,
            minutes
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [contractId, day.weekday, blockIndex + 1, block.startTime, block.endTime, block.minutes]
        );
      }
    }
  }
}

export const userService = {
  async listUsers(db: AppDatabase, companyId: string, options?: { activeOnly?: boolean }) {
    const rows = await db.all(
      `SELECT id, full_name, is_active, role
       FROM users
       WHERE deleted_at IS NULL ${options?.activeOnly ? "AND is_active = 1" : ""}
       ORDER BY full_name COLLATE NOCASE ASC`,
      []
    );
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
        custom_field_values_json,
        created_at
      FROM users
      WHERE id = ? AND deleted_at IS NULL`,
      [userId]
    );

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const contracts = await this.listUserContracts(db, companyId, userId);

    return mapCompanyUserDetail(row, contracts);
  },

  async listUserContracts(db: AppDatabase, companyId: string, userId: number) {
    const contracts = await db.all(
      `SELECT
        id,
        user_id,
        hours_per_week,
        start_date,
        end_date,
        payment_per_hour,
        annual_vacation_days,
        created_at
      FROM user_contracts
      WHERE user_id = ?
      ORDER BY start_date ASC`,
      [userId]
    ) as Array<{
      id: number;
      user_id: number;
      hours_per_week: number;
      start_date: string;
      end_date: string | null;
      payment_per_hour: number;
      annual_vacation_days: number;
      created_at: string;
    }>;

    if (contracts.length === 0) {
      return [];
    }

    const placeholders = contracts.map(() => "?").join(", ");
    const scheduleRows = await db.all(
      `SELECT
        contract_id,
        weekday,
        block_order,
        start_time,
        end_time,
        minutes
      FROM user_contract_schedule_blocks
      WHERE contract_id IN (${placeholders})
      ORDER BY contract_id ASC, weekday ASC, block_order ASC`,
      contracts.map((contract) => contract.id)
    ) as Array<{
      contract_id: number;
      weekday: number;
      block_order: number;
      start_time: string | null;
      end_time: string | null;
      minutes: number;
    }>;

    const scheduleByContract = new Map<number, ReturnType<typeof mapUserContractScheduleBlock>[]>();
    for (const row of scheduleRows) {
      const next = scheduleByContract.get(row.contract_id) ?? [];
      next.push(mapUserContractScheduleBlock(row));
      scheduleByContract.set(row.contract_id, next);
    }

    return contracts.map((contract) => mapUserContract(contract, scheduleByContract.get(contract.id) ?? []));
  },

  async createUser(db: AppDatabase, companyId: string, input: CreateUserInput, todayDay: string) {
    const existing = await db.first("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL", [input.username.trim()]);
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    await ensureUniquePin(db, companyId, input.pinCode);
    validateContracts(input.contracts, todayDay);
    const result = await db.run(
      `INSERT INTO users (
        username,
        full_name,
        password_hash,
        role,
        is_active,
        pin_code,
        email,
        custom_field_values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.username.trim(),
        input.fullName.trim(),
        bcrypt.hashSync(input.password, 10),
        input.role,
        input.isActive ? 1 : 0,
        input.pinCode,
        normalizeOptionalText(input.email),
        JSON.stringify(input.customFieldValues ?? {}),
        new Date().toISOString()
      ]
    );

    const userId = Number(result.lastRowId);
    await saveContracts(db, companyId, userId, input.contracts, todayDay);
    return userId;
  },

  async updateUser(db: AppDatabase, companyId: string, input: UpdateUserInput, todayDay: string) {
    const existing = await db.first("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", [input.userId]);
    if (!existing) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const duplicateUsername = await db.first("SELECT id FROM users WHERE username = ? AND id != ? AND deleted_at IS NULL", [
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
            await db.first("SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL", [input.userId]) as { password_hash: string }
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
         email = ?,
         custom_field_values_json = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        input.username.trim(),
        input.fullName.trim(),
        passwordHash,
        input.role,
        input.isActive ? 1 : 0,
        input.pinCode,
        normalizeOptionalText(input.email),
        JSON.stringify(input.customFieldValues ?? {}),
        input.userId
      ]
    );

    await saveContracts(db, companyId, input.userId, input.contracts, todayDay);
  },

  async deleteUser(db: AppDatabase, companyId: string, userId: number) {
    await ensureAdminRoleWillRemainAsync(db, companyId, userId);
    const result = await db.run(
      `UPDATE users
       SET
         is_active = 0,
         deleted_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [new Date().toISOString(), userId]
    );
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "User not found" });
    }
  }
};
