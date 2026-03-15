import { Hono } from "hono";
import { z } from "zod";
import { countEffectiveLeaveDays, diffCalendarDays, formatLocalDay } from "../../../shared/utils/time";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import type { CompanyTokenPayload } from "../../auth/jwt";
import { timeService } from "../../services/time-service";
import { userService } from "../../services/user-service";
import { settingsService } from "../../services/settings-service";
import { calculateLeaveCompensation, calculateWorkDurationMinutes, enumerateDayRange, getExpectedContractMinutesForDay, getWeekRange, getMonthRange } from "../../services/time-entry-metrics-service";
import type { AppVariables } from "../context";

const startTimerSchema = z.object({
  notes: z.string().optional()
});

const stopTimerSchema = z.object({
  entryId: z.number().optional(),
  notes: z.string().optional()
});

const attachmentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    dataUrl: z.string().startsWith("data:").max(10_000_000)
  })
  .nullable();

const customFieldValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

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

export const timeRoutes = new Hono<{ Variables: AppVariables }>();

timeRoutes.use("*", authMiddleware, requireCompanyUser);

function hasCustomFieldValue(value: string | number | boolean | undefined) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

function validateCustomFields(
  settings: ReturnType<typeof settingsService.getSettings>,
  entryType: "work" | "vacation" | "sick_leave",
  values: Record<string, string | number | boolean>
) {
  const applicableFields = settings.customFields.filter((field) => field.targets.includes(entryType));
  for (const field of applicableFields) {
    if (field.required && !hasCustomFieldValue(values[field.id])) {
      throw new Error(`${field.label} is required`);
    }
  }
}

function resolveTargetUserId(session: CompanyTokenPayload, requestedUserId?: number) {
  if (!requestedUserId || requestedUserId === session.userId) {
    return session.userId;
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

function enforceDayLimit(
  session: CompanyTokenPayload,
  limit: number,
  day: string,
  message: string
) {
  if (session.role === "admin" || session.role === "manager") {
    return;
  }

  if (diffCalendarDays(formatLocalDay(new Date()), day) > limit) {
    throw new Error(message);
  }
}

async function enrichEntryWithDayMetrics(
  databasePath: string,
  entry: Awaited<ReturnType<typeof timeService.getEntryById>>
) {
  const settings = settingsService.getSettings(databasePath);
  if (entry.entryType === "work") {
    const totalDayCount = entry.endDate ? Math.max(1, diffCalendarDays(entry.endDate, entry.entryDate) + 1) : 1;
    return {
      ...entry,
      durationMinutes: calculateWorkDurationMinutes(entry.startTime, entry.endTime, settings),
      totalDayCount,
      effectiveDayCount: totalDayCount,
      excludedHolidayCount: 0,
      excludedWeekendCount: 0,
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
    Array.from(holidayYears).map((holidayYear) => settingsService.getPublicHolidays(databasePath, settings.country, holidayYear)),
  );
  const holidaySet = new Set(
    holidays
      .flatMap((response) => response.holidays)
      .map((holiday) => holiday.date),
  );
  const metrics = countEffectiveLeaveDays(startDay, endDay, holidaySet);

  return {
    ...entry,
    ...metrics,
  };
}

async function enrichEntriesWithDayMetrics(
  databasePath: string,
  entries: ReturnType<typeof timeService.listEntries>
) {
  return Promise.all(entries.map((entry) => enrichEntryWithDayMetrics(databasePath, entry)));
}

async function getHolidaySetForRange(databasePath: string, country: string, startDay: string, endDay: string) {
  const years = new Set<number>();
  let year = Number(startDay.slice(0, 4));
  const finalYear = Number(endDay.slice(0, 4));

  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }

  const responses = await Promise.all(
    Array.from(years).map((currentYear) => settingsService.getPublicHolidays(databasePath, country, currentYear)),
  );

  return new Set(
    responses.flatMap((response) => response.holidays).map((holiday) => holiday.date),
  );
}

async function buildDashboardSummary(databasePath: string, userId: number) {
  const settings = settingsService.getSettings(databasePath);
  const todayDay = formatLocalDay(new Date());
  const fullWeekRange = getWeekRange(todayDay, settings.firstDayOfWeek);
  const fullMonthRange = getMonthRange(todayDay);
  const weekRange = { startDay: fullWeekRange.startDay, endDay: todayDay };
  const monthRange = { startDay: fullMonthRange.startDay, endDay: todayDay };
  const contracts = userService.listUserContracts(databasePath, userId);
  const allEntries = timeService.listEntries(databasePath, userId, {});
  const currentContract =
    contracts.find((contract) => contract.startDate <= todayDay && (contract.endDate === null || contract.endDate >= todayDay)) ?? null;
  const historyStartDay = [
    ...contracts.map((contract) => contract.startDate),
    ...allEntries.map((entry) => entry.entryDate),
    todayDay,
  ].sort((left, right) => left.localeCompare(right))[0];
  const holidaySet = await getHolidaySetForRange(
    databasePath,
    settings.country,
    historyStartDay,
    todayDay,
  );

  const todayEntries = timeService.listEntries(databasePath, userId, { from: todayDay, to: todayDay });
  const weekEntries = timeService.listEntries(databasePath, userId, { from: weekRange.startDay, to: weekRange.endDay });
  const monthEntries = timeService.listEntries(databasePath, userId, { from: monthRange.startDay, to: monthRange.endDay });
  const activeEntry = timeService.getActiveEntry(databasePath, userId);

  function getRecordedMinutes(entries: ReturnType<typeof timeService.listEntries>, startDay: string, endDay: string) {
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
    return enumerateDayRange(startDay, endDay).reduce(
      (sum, day) => sum + getExpectedContractMinutesForDay(day, holidaySet, contracts),
      0,
    );
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
    activeEntry: activeEntry ? await enrichEntryWithDayMetrics(databasePath, activeEntry) : null,
    recentEntries: await enrichEntriesWithDayMetrics(databasePath, allEntries.slice(0, 5)),
    contractStats: {
      currentContract: currentContract
        ? {
            hoursPerWeek: currentContract.hoursPerWeek,
            paymentPerHour: currentContract.paymentPerHour,
            startDate: currentContract.startDate,
            endDate: currentContract.endDate,
          }
        : null,
      totalBalanceMinutes: totalRecordedMinutes - totalExpectedMinutes,
      today: {
        expectedMinutes: todayExpectedMinutes,
        recordedMinutes: todayRecordedMinutes,
        balanceMinutes: todayRecordedMinutes - todayExpectedMinutes,
      },
      week: {
        expectedMinutes: weekExpectedMinutes,
        recordedMinutes: weekRecordedMinutes,
        balanceMinutes: weekRecordedMinutes - weekExpectedMinutes,
      },
      month: {
        expectedMinutes: monthExpectedMinutes,
        recordedMinutes: monthRecordedMinutes,
        balanceMinutes: monthRecordedMinutes - monthExpectedMinutes,
      },
    },
  };
}

timeRoutes.post("/start", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  const body = startTimerSchema.parse(await c.req.json());
  return c.json({
    entry: timeService.startTimer(session.databasePath, session.userId, body)
  });
});

timeRoutes.post("/entry", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);

  const body = createManualEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  const settings = settingsService.getSettings(session.databasePath);
  try {
    enforceDayLimit(session, settings.insertDaysLimit, body.startDate, "Insert day limit reached");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Insert day limit reached" }, 403);
  }
  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }

  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }
  try {
    validateCustomFields(settings, body.entryType, body.customFieldValues);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid custom fields" }, 400);
  }

  const createdEntry = timeService.createManualEntry(session.databasePath, targetUserId, body);
  return c.json({
    entry: await enrichEntryWithDayMetrics(session.databasePath, createdEntry)
  });
});

timeRoutes.post("/stop", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  const body = stopTimerSchema.parse(await c.req.json());
  return c.json({
    entry: timeService.stopTimer(session.databasePath, session.userId, body)
  });
});

timeRoutes.get("/list", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  return c.json({
    entries: await enrichEntriesWithDayMetrics(session.databasePath, timeService.listEntries(session.databasePath, targetUserId, {
      from: c.req.query("from"),
      to: c.req.query("to")
    }))
  });
});

timeRoutes.get("/entry/:entryId", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  const entryId = Number(c.req.param("entryId"));
  const entry = timeService.getEntryById(session.databasePath, entryId);
  if (entry.userId !== targetUserId) {
    return c.json({ error: "Time entry not found" }, 404);
  }
  return c.json({ entry: await enrichEntryWithDayMetrics(session.databasePath, entry) });
});

timeRoutes.put("/entry", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  const body = updateEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  const settings = settingsService.getSettings(session.databasePath);
  try {
    enforceDayLimit(session, settings.editDaysLimit, body.startDate, "Edit day limit reached");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Edit day limit reached" }, 403);
  }
  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  if (body.entryType !== "sick_leave" && body.sickLeaveAttachment !== null) {
    return c.json({ error: "Attachments are only allowed for sick leave" }, 400);
  }
  try {
    validateCustomFields(settings, body.entryType, body.customFieldValues);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid custom fields" }, 400);
  }
  const updatedEntry = timeService.updateEntry(session.databasePath, targetUserId, body);
  return c.json({
    entry: await enrichEntryWithDayMetrics(session.databasePath, updatedEntry)
  });
});

timeRoutes.delete("/entry", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  const body = deleteEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = resolveTargetUserId(session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  timeService.deleteEntry(session.databasePath, targetUserId, body.entryId);
  return c.json({ success: true });
});

timeRoutes.get("/dashboard", async (c) => {
  const rawSession = c.get("session");
  if (rawSession.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  const session = getCompanySession(rawSession);
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = resolveTargetUserId(session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  return c.json({ summary: await buildDashboardSummary(session.databasePath, targetUserId) });
});
