import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { CreateUserInput, UpdateUserInput, UserContractInput } from "../../shared/types/api";
import { userContractScheduleBlocks, userContracts, users } from "../db/schema";
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
  const target = await db.orm.select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .get() as
    | { role: "employee" | "manager" | "admin" }
    | undefined;
  if (!target) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const effectiveRole = nextRole ?? target.role;
  if (target.role !== "admin" || effectiveRole === "admin") {
    return;
  }

  const adminCountRow = await db.orm.select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.deletedAt)))
    .get();
  if ((adminCountRow?.count ?? 0) <= 1) {
    throw new HTTPException(400, { message: "At least one admin is required" });
  }
}

async function ensureUniquePin(db: AppDatabase, companyId: string, pinCode: string, userId?: number) {
  const existing = await db.orm.select({ id: users.id })
    .from(users)
    .where(
      userId
        ? and(eq(users.pinCode, pinCode), ne(users.id, userId), isNull(users.deletedAt))
        : and(eq(users.pinCode, pinCode), isNull(users.deletedAt))
    )
    .get();

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
  await db.orm.transaction(async (tx: any) => {
    await tx.delete(userContracts).where(eq(userContracts.userId, userId)).run();

    for (const contract of normalizedContracts) {
      const createdAt = new Date().toISOString();
      const insertedContracts = await tx.insert(userContracts).values({
        userId,
        hoursPerWeek: contract.hoursPerWeek,
        startDate: contract.startDate,
        endDate: contract.endDate,
        paymentPerHour: contract.paymentPerHour,
        annualVacationDays: contract.annualVacationDays,
        createdAt,
      }).returning({ id: userContracts.id });
      const contractId = Number(insertedContracts[0]?.id);

      for (const day of contract.schedule) {
        for (const [blockIndex, block] of day.blocks.entries()) {
          await tx.insert(userContractScheduleBlocks).values({
            contractId,
            weekday: day.weekday,
            blockOrder: blockIndex + 1,
            startTime: block.startTime,
            endTime: block.endTime,
            minutes: block.minutes,
          }).run();
        }
      }
    }
  });
}

export const userService = {
  async listUsers(db: AppDatabase, companyId: string, options?: { activeOnly?: boolean }) {
    const rows = await db.orm.select({
      id: users.id,
      full_name: users.fullName,
      is_active: users.isActive,
      role: users.role,
    }).from(users)
      .where(and(isNull(users.deletedAt), options?.activeOnly ? eq(users.isActive, 1) : undefined))
      .orderBy(sql`full_name COLLATE NOCASE ASC`);
    return rows.map(mapCompanyUserListItem);
  },

  async getUser(db: AppDatabase, companyId: string, userId: number) {
    const row = await db.orm.select({
      id: users.id,
      username: users.username,
      full_name: users.fullName,
      is_active: users.isActive,
      role: users.role,
      pin_code: users.pinCode,
      email: users.email,
      custom_field_values_json: users.customFieldValuesJson,
      created_at: users.createdAt,
    }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get();

    if (!row) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const contracts = await this.listUserContracts(db, companyId, userId);

    return mapCompanyUserDetail(row, contracts);
  },

  async listUserContracts(db: AppDatabase, companyId: string, userId: number) {
    const contracts = await db.orm.select({
      id: userContracts.id,
      user_id: userContracts.userId,
      hours_per_week: userContracts.hoursPerWeek,
      start_date: userContracts.startDate,
      end_date: userContracts.endDate,
      payment_per_hour: userContracts.paymentPerHour,
      annual_vacation_days: userContracts.annualVacationDays,
      created_at: userContracts.createdAt,
    }).from(userContracts).where(eq(userContracts.userId, userId)).orderBy(asc(userContracts.startDate));

    if (contracts.length === 0) {
      return [];
    }

    const scheduleRows = await db.orm.select({
      contract_id: userContractScheduleBlocks.contractId,
      weekday: userContractScheduleBlocks.weekday,
      block_order: userContractScheduleBlocks.blockOrder,
      start_time: userContractScheduleBlocks.startTime,
      end_time: userContractScheduleBlocks.endTime,
      minutes: userContractScheduleBlocks.minutes,
    }).from(userContractScheduleBlocks)
      .where(inArray(userContractScheduleBlocks.contractId, contracts.map((contract: (typeof contracts)[number]) => contract.id)))
      .orderBy(
        asc(userContractScheduleBlocks.contractId),
        asc(userContractScheduleBlocks.weekday),
        asc(userContractScheduleBlocks.blockOrder)
      );

    const scheduleByContract = new Map<number, ReturnType<typeof mapUserContractScheduleBlock>[]>();
    for (const row of scheduleRows) {
      const next = scheduleByContract.get(row.contract_id) ?? [];
      next.push(mapUserContractScheduleBlock(row));
      scheduleByContract.set(row.contract_id, next);
    }

    return contracts.map((contract: (typeof contracts)[number]) => mapUserContract(contract, scheduleByContract.get(contract.id) ?? []));
  },

  async createUser(db: AppDatabase, companyId: string, input: CreateUserInput, todayDay: string) {
    const existing = await db.orm.select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, input.username.trim()), isNull(users.deletedAt)))
      .get();
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    await ensureUniquePin(db, companyId, input.pinCode);
    validateContracts(input.contracts, todayDay);
    const result = await db.orm.insert(users).values({
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: input.role,
      isActive: input.isActive ? 1 : 0,
      pinCode: input.pinCode,
      email: normalizeOptionalText(input.email),
      customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
      createdAt: new Date().toISOString()
    }).returning({ id: users.id });

    const userId = Number(result[0]?.id);
    await saveContracts(db, companyId, userId, input.contracts, todayDay);
    return userId;
  },

  async updateUser(db: AppDatabase, companyId: string, input: UpdateUserInput, todayDay: string) {
    const existing = await db.orm.select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .get();
    if (!existing) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const duplicateUsername = await db.orm.select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, input.username.trim()), ne(users.id, input.userId), isNull(users.deletedAt)))
      .get();
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
            await db.orm.select({ password_hash: users.passwordHash })
              .from(users)
              .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
              .get() as { password_hash: string }
          ).password_hash;

    await db.orm.update(users).set({
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash,
      role: input.role,
      isActive: input.isActive ? 1 : 0,
      pinCode: input.pinCode,
      email: normalizeOptionalText(input.email),
      customFieldValuesJson: JSON.stringify(input.customFieldValues ?? {}),
    }).where(and(eq(users.id, input.userId), isNull(users.deletedAt))).run();

    await saveContracts(db, companyId, input.userId, input.contracts, todayDay);
  },

  async deleteUser(db: AppDatabase, companyId: string, userId: number) {
    await ensureAdminRoleWillRemainAsync(db, companyId, userId);
    const result = await db.orm.update(users).set({
      isActive: 0,
      deletedAt: new Date().toISOString(),
    }).where(and(eq(users.id, userId), isNull(users.deletedAt))).run();
    if (result.changes === 0) {
      throw new HTTPException(404, { message: "User not found" });
    }
  }
};
