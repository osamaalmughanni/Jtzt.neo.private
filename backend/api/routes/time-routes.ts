import { Hono } from "hono";
import { z } from "zod";
import { countEffectiveLeaveDays, diffCalendarDays } from "../../../shared/utils/time";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import type { CompanyTokenPayload } from "../../auth/jwt";
import { settingsService } from "../../services/settings-service";
import { timeService } from "../../services/time-service";
import {
  calculateLeaveCompensation,
  calculateWorkDurationMinutes,
  enumerateDayRange,
  getExpectedContractMinutesForDay,
  getMonthRange,
  getWeekRange
} from "../../services/time-entry-metrics-service";
import { userService } from "../../services/user-service";
import type { AppRouteConfig, AppVariables } from "../context";
import type { AppDatabase } from "../../runtime/types";

const attachmentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    dataUrl: z.string().startsWith("data:").max(10_000_000)
  })
  .nullable();

const customFieldValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

const startTimerSchema = z.object({
  notes: z.string().optional(),
  customFieldValues: customFieldValuesSchema.optional()
});

const stopTimerSchema = z.object({
  entryId: z.number().optional(),
  notes: z.string().optional()
});

const updateEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  sickLeaveAttachment: attachmentSchema,
  customFieldValues: customFieldValuesSchema
});

const createManualEntrySchema = z.object({
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  sickLeaveAttachment: attachmentSchema,
  customFieldValues: customFieldValuesSchema
});

const deleteEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional()
});

export const timeRoutes = new Hono<AppRouteConfig>();

timeRoutes.use("*", authMiddleware, requireCompanyUser);

function hasCustomFieldValue(value: string | number | boolean | undefined) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

async function validateCustomFields(
  db: AppDatabase,
  companyId: string,
  entryType: "work" | "vacation" | "sick_leave",
  values: Record<string, string | number | boolean>
) {
  const settings = await settingsService.getSettings(db, companyId);
  const applicableFields = settings.customFields.filter((field) => field.targets.includes(entryType));
  for (const field of applicableFields) {
    if (field.required && !hasCustomFieldValue(values[field.id])) {
      throw new Error(`${field.label} is required`);
    }
  }
  return settings;
}

function resolveTargetUserId(session: CompanyTokenPayload, requestedUserId?: number) {
  if (!requestedUserId || requestedUserId === session.userId) {
    return session.userId;
  }
  if (session.accessMode === "tablet") {
    throw new Error("Tablet mode can only create records for the signed-in user");
  }
  if (session.role !== "admin" && session.role !== "manager") {
    throw new Error("Manager access required");
  }
  return requestedUserId;
}

function getCompanySession(session: AppVariables["session"]): CompanyTokenPayload {
  if (session.actorType !== "company_user") {
    throw new Error("Company login required");
  }
  return session;
}

function enforceDayLimit(session: CompanyTokenPayload, limit: number, todayDay: string, day: string, message: string) {
  if (session.role === "admin" || session.role === "manager") {
    return;
  }
  if (diffCalendarDays(todayDay, day) > limit) {
    throw new Error(message);
  }
}

async function enforceSingleRecordPerDay(
  db: AppDatabase,
  companyId: string,
  userId: number,
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  startDate: string,
  endDate?: string | null,
  excludeEntryId?: number
) {
  if (!settings.allowOneRecordPerDay) {
    return;
  }
  const rangeEnd = endDate && endDate >= startDate ? endDate : startDate;
  if (await timeService.hasEntryOnRange(db, companyId, userId, startDate, rangeEnd, excludeEntryId)) {
    throw new Error("Only one record per day is allowed");
  }
}

async function enforceIntersectingRecords(
  db: AppDatabase,
  companyId: string,
  userId: number,
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave";
    startDate: string;
    endDate?: string | null;
    startTime: string | null;
    endTime: string | null;
  },
  excludeEntryId?: number
) {
  if (settings.allowIntersectingRecords) {
    return;
  }
  const normalizedEndDate = candidate.endDate && candidate.endDate >= candidate.startDate ? candidate.endDate : candidate.startDate;
  if (
    await timeService.hasIntersectingEntry(
      db,
      companyId,
      userId,
      {
        entryType: candidate.entryType,
        entryDate: candidate.startDate,
        endDate: normalizedEndDate === candidate.startDate ? null : normalizedEndDate,
        startTime: candidate.startTime,
        endTime: candidate.endTime
      },
      excludeEntryId
    )
  ) {
    throw new Error("Intersecting records are not allowed");
  }
}

async function enrichEntryWithDayMetrics(db: AppDatabase, companyId: string, entry: Awaited<ReturnType<typeof timeService.getEntryById>>) {
  const settings = await settingsService.getSettings(db, companyId);
  if (entry.entryType === "work") {
    const totalDayCount = entry.endDate ? Math.max(1, diffCalendarDays(entry.endDate, entry.entryDate) + 1) : 1;
    return {
      ...entry,
      durationMinutes: calculateWorkDurationMinutes(entry.startTime, entry.endTime, settings),
      totalDayCount,
      effectiveDayCount: totalDayCount,
      excludedHolidayCount: 0,
      excludedWeekendCount: 0
    };
  }

  const startDay = entry.entryDate;
  const endDay = entry.endDate ?? entry.entryDate;
  const holidayYears = new Set<number>();
  let year = Number(startDay.slice(0, 4));
  const lastYear = Number(endDay.slice(0, 4));
  while (year <= lastYear) {
    holidayYears.add(year);
    year += 1;
  }

  const holidays = await Promise.all(
    Array.from(holidayYears).map((holidayYear) => settingsService.getPublicHolidays(db, companyId, settings.country, holidayYear))
  );
  const holidaySet = new Set(holidays.flatMap((response) => response.holidays).map((holiday) => holiday.date));
  return {
    ...entry,
    ...countEffectiveLeaveDays(startDay, endDay, holidaySet)
  };
}

async function enrichEntriesWithDayMetrics(
  db: AppDatabase,
  companyId: string,
  entries: Awaited<ReturnType<typeof timeService.listEntries>>
) {
  return Promise.all(entries.map((entry) => enrichEntryWithDayMetrics(db, companyId, entry)));
}

async function getHolidaySetForRange(db: AppDatabase, companyId: string, country: string, startDay: string, endDay: string) {
  const years = new Set<number>();
  let year = Number(startDay.slice(0, 4));
  const finalYear = Number(endDay.slice(0, 4));
  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }

  const responses = await Promise.all(Array.from(years).map((currentYear) => settingsService.getPublicHolidays(db, companyId, country, currentYear)));
  return new Set(responses.flatMap((response) => response.holidays).map((holiday) => holiday.date));
}

async function buildDashboardSummary(db: AppDatabase, companyId: string, userId: number) {
  const settings = await settingsService.getSettings(db, companyId);
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, companyId)).localDay;
  const fullWeekRange = getWeekRange(todayDay, settings.firstDayOfWeek);
  const fullMonthRange = getMonthRange(todayDay);
  const weekRange = { startDay: fullWeekRange.startDay, endDay: todayDay };
  const monthRange = { startDay: fullMonthRange.startDay, endDay: todayDay };
  const contracts = await userService.listUserContracts(db, companyId, userId);
  const allEntries = await timeService.listEntries(db, companyId, userId, {});
  const currentContract =
    contracts.find((contract) => contract.startDate <= todayDay && (contract.endDate === null || contract.endDate >= todayDay)) ?? null;
  const historyStartDay = [...contracts.map((contract) => contract.startDate), ...allEntries.map((entry) => entry.entryDate), todayDay].sort(
    (left, right) => left.localeCompare(right)
  )[0];
  const holidaySet = await getHolidaySetForRange(db, companyId, settings.country, historyStartDay, todayDay);

  const todayEntries = await timeService.listEntries(db, companyId, userId, { from: todayDay, to: todayDay });
  const weekEntries = await timeService.listEntries(db, companyId, userId, { from: weekRange.startDay, to: weekRange.endDay });
  const monthEntries = await timeService.listEntries(db, companyId, userId, { from: monthRange.startDay, to: monthRange.endDay });
  const activeEntry = await timeService.getActiveEntry(db, companyId, userId);

  function getRecordedMinutes(entries: Awaited<ReturnType<typeof timeService.listEntries>>, startDay: string, endDay: string) {
    return entries.reduce((sum, entry) => {
      if (entry.entryType === "work") {
        return sum + calculateWorkDurationMinutes(entry.startTime, entry.endTime, settings);
      }

      const clampedStart = entry.entryDate < startDay ? startDay : entry.entryDate;
      const entryEndDay = entry.endDate ?? entry.entryDate;
      const clampedEnd = entryEndDay > endDay ? endDay : entryEndDay;
      return sum + calculateLeaveCompensation(entry.entryType, clampedStart, clampedEnd, holidaySet, contracts).durationMinutes;
    }, 0);
  }

  function getExpectedMinutes(startDay: string, endDay: string) {
    return enumerateDayRange(startDay, endDay).reduce((sum, day) => sum + getExpectedContractMinutesForDay(day, holidaySet, contracts), 0);
  }

  const todayRecordedMinutes = getRecordedMinutes(todayEntries, todayDay, todayDay);
  const weekRecordedMinutes = getRecordedMinutes(weekEntries, weekRange.startDay, weekRange.endDay);
  const monthRecordedMinutes = getRecordedMinutes(monthEntries, monthRange.startDay, monthRange.endDay);
  const todayExpectedMinutes = getExpectedMinutes(todayDay, todayDay);
  const weekExpectedMinutes = getExpectedMinutes(weekRange.startDay, weekRange.endDay);
  const monthExpectedMinutes = getExpectedMinutes(monthRange.startDay, monthRange.endDay);
  const totalRecordedMinutes = getRecordedMinutes(allEntries, historyStartDay, todayDay);
  const totalExpectedMinutes = getExpectedMinutes(historyStartDay, todayDay);

  return {
    todayMinutes: todayRecordedMinutes,
    weekMinutes: weekRecordedMinutes,
    activeEntry: activeEntry ? await enrichEntryWithDayMetrics(db, companyId, activeEntry) : null,
    recentEntries: await enrichEntriesWithDayMetrics(db, companyId, allEntries.slice(0, 5)),
    contractStats: {
      currentContract: currentContract
        ? {
            hoursPerWeek: currentContract.hoursPerWeek,
            paymentPerHour: currentContract.paymentPerHour,
            startDate: currentContract.startDate,
            endDate: currentContract.endDate
          }
        : null,
      totalBalanceMinutes: totalRecordedMinutes - totalExpectedMinutes,
      today: {
        expectedMinutes: todayExpectedMinutes,
        recordedMinutes: todayRecordedMinutes,
        balanceMinutes: todayRecordedMinutes - todayExpectedMinutes
      },
      week: {
        expectedMinutes: weekExpectedMinutes,
        recordedMinutes: weekRecordedMinutes,
        balanceMinutes: weekRecordedMinutes - weekExpectedMinutes
      },
      month: {
        expectedMinutes: monthExpectedMinutes,
        recordedMinutes: monthRecordedMinutes,
        balanceMinutes: monthRecordedMinutes - monthExpectedMinutes
      }
    }
  };
}

timeRoutes.post("/start", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = startTimerSchema.parse(await c.req.json());
  const settings = await settingsService.getSettings(db, session.companyId);
  const snapshot = await settingsService.getBusinessNowSnapshot(db, session.companyId);

  try {
    await enforceSingleRecordPerDay(db, session.companyId, session.userId, settings, snapshot.localDay);
    await enforceIntersectingRecords(db, session.companyId, session.userId, settings, {
      entryType: "work",
      startDate: snapshot.localDay,
      endDate: null,
      startTime: snapshot.instantIso,
      endTime: null
    });
    await validateCustomFields(db, session.companyId, "work", body.customFieldValues ?? {});
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Record rule violation" }, 400);
  }

  return c.json({
    entry: await timeService.startTimer(db, session.companyId, session.userId, body, snapshot)
  });
});

timeRoutes.post("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = createManualEntrySchema.parse(await c.req.json());
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;

  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const settings = await settingsService.getSettings(db, session.companyId);
  try {
    enforceDayLimit(session, settings.insertDaysLimit, todayDay, body.startDate, "Insert day limit reached");
    await enforceSingleRecordPerDay(db, session.companyId, targetUserId, settings, body.startDate, body.endDate);
    await enforceIntersectingRecords(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime,
      endTime: body.endTime
    });
    await validateCustomFields(db, session.companyId, body.entryType, body.customFieldValues);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Insert day limit reached" }, 403);
  }

  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }

  const createdEntry = await timeService.createManualEntry(db, session.companyId, targetUserId, body);
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, createdEntry) });
});

timeRoutes.post("/stop", async (c) => {
  const session = getCompanySession(c.get("session"));
  const body = stopTimerSchema.parse(await c.req.json());
  return c.json({
    entry: await timeService.stopTimer(c.get("db"), session.companyId, session.userId, body)
  });
});

timeRoutes.get("/list", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const entries = await timeService.listEntries(db, session.companyId, targetUserId, {
    from: c.req.query("from"),
    to: c.req.query("to")
  });
  return c.json({ entries: await enrichEntriesWithDayMetrics(db, session.companyId, entries) });
});

timeRoutes.get("/entry/:entryId", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const entry = await timeService.getEntryById(db, session.companyId, Number(c.req.param("entryId")));
  if (entry.userId !== targetUserId) {
    return c.json({ error: "Time entry not found" }, 404);
  }
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, entry) });
});

timeRoutes.put("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = updateEntrySchema.parse(await c.req.json());
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;

  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const settings = await settingsService.getSettings(db, session.companyId);
  try {
    enforceDayLimit(session, settings.editDaysLimit, todayDay, body.startDate, "Edit day limit reached");
    await enforceSingleRecordPerDay(db, session.companyId, targetUserId, settings, body.startDate, body.endDate, body.entryId);
    await enforceIntersectingRecords(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime,
      endTime: body.endTime
    }, body.entryId);
    await validateCustomFields(db, session.companyId, body.entryType, body.customFieldValues);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Edit day limit reached" }, 403);
  }

  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }

  const updatedEntry = await timeService.updateEntry(db, session.companyId, targetUserId, body);
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, updatedEntry) });
});

timeRoutes.delete("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const body = deleteEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  await timeService.deleteEntry(c.get("db"), session.companyId, targetUserId, body.entryId);
  return c.json({ success: true });
});

timeRoutes.get("/dashboard", async (c) => {
  const session = getCompanySession(c.get("session"));
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  return c.json({ summary: await buildDashboardSummary(c.get("db"), session.companyId, targetUserId) });
});
