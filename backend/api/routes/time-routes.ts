import { Hono } from "hono";
import { z } from "zod";
import { diffCalendarDays, enumerateLocalDays, isWeekendDay } from "../../../shared/utils/time";
import { evaluateTimeEntryPolicy, getRangeEndDay } from "../../../shared/utils/time-entry-policy";
import { validateCustomFieldValuesForTarget } from "../../../shared/utils/custom-fields";
import { authMiddleware, companyDbMiddleware, hasCompanyAccess, requireCompanyUser } from "../../auth/middleware";
import type { CompanyTokenPayload, SessionTokenPayload } from "../../auth/jwt";
import { settingsService } from "../../services/settings-service";
import { timeOffInLieuService } from "../../services/time-off-in-lieu-service";
import { timeService } from "../../services/time-service";
import { vacationBalanceService } from "../../services/vacation-balance-service";
import {
  calculateLeaveCompensation,
  calculateExpectedContractMinutesForRange,
  calculateRecordedMinutesForRange,
  calculateWorkDurationMinutes,
  getMonthRange,
  getWeekRange
} from "../../services/time-entry-metrics-service";
import { userService } from "../../services/user-service";
import type { AppRouteConfig, AppVariables } from "../context";
import type { AppDatabase } from "../../runtime/types";

const customFieldValuesSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

const startTimerSchema = z.object({
  notes: z.string().optional(),
  projectId: z.number().int().positive().nullable().optional(),
  taskId: z.number().int().positive().nullable().optional(),
  customFieldValues: customFieldValuesSchema.optional()
});

const stopTimerSchema = z.object({
  entryId: z.number().optional(),
  notes: z.string().optional()
});

const updateEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave", "time_off_in_lieu"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  projectId: z.number().int().positive().nullable().optional(),
  taskId: z.number().int().positive().nullable().optional(),
  customFieldValues: customFieldValuesSchema
});

const createManualEntrySchema = z.object({
  targetUserId: z.number().optional(),
  entryType: z.enum(["work", "vacation", "sick_leave", "time_off_in_lieu"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string(),
  projectId: z.number().int().positive().nullable().optional(),
  taskId: z.number().int().positive().nullable().optional(),
  customFieldValues: customFieldValuesSchema
});

const deleteEntrySchema = z.object({
  entryId: z.number(),
  targetUserId: z.number().optional()
});

export const timeRoutes = new Hono<AppRouteConfig>();

timeRoutes.use("*", authMiddleware, requireCompanyUser, companyDbMiddleware);

async function validateCustomFields(
  db: AppDatabase,
  companyId: string,
  entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu",
  values: Record<string, string | number | boolean>
) {
  const settings = await settingsService.getSettings(db, companyId);
  return validateCustomFieldValuesForTarget(settings.customFields, { scope: "time_entry", entryType }, values);
}

async function resolveTargetUserId(
  db: AppDatabase,
  session: CompanyTokenPayload | Extract<SessionTokenPayload, { actorType: "workspace" }>,
  requestedUserId?: number,
) {
  const normalizedRequestedUserId = requestedUserId && requestedUserId > 0 ? requestedUserId : undefined;

  if (session.actorType === "workspace") {
    if (normalizedRequestedUserId) {
      return normalizedRequestedUserId;
    }

    const firstActiveUser = await db.first<{ id: number }>(
      `SELECT id
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY is_active DESC, full_name COLLATE NOCASE ASC, id ASC
       LIMIT 1`,
      []
    );
    if (!firstActiveUser) {
      throw new Error("No active users found");
    }
    return firstActiveUser.id;
  }

  if (!normalizedRequestedUserId || normalizedRequestedUserId === session.userId) {
    return session.userId;
  }
  if (session.accessMode === "tablet") {
    throw new Error("Tablet mode can only create records for the signed-in user");
  }
  if (session.role !== "admin" && session.role !== "manager") {
    throw new Error("Manager access required");
  }
  return normalizedRequestedUserId;
}

function getCompanySession(session: AppVariables["session"]): CompanyTokenPayload | Extract<SessionTokenPayload, { actorType: "workspace" }> {
  if (!hasCompanyAccess(session)) {
    throw new Error("Company login required");
  }
  return session;
}

async function resolveProjectTaskSelection(
  db: AppDatabase,
  companyId: string,
  userId: number,
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  input: { projectId?: number | null; taskId?: number | null; entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu" }
) {
  if (input.entryType !== "work") {
    return { projectId: null, taskId: null };
  }

  const projectId = settings.projectsEnabled ? input.projectId ?? null : null;
  const taskId = settings.tasksEnabled ? input.taskId ?? null : null;

  if (settings.projectsEnabled && !projectId) {
    throw new Error("Project is required");
  }
  if (settings.tasksEnabled && !taskId) {
    throw new Error("Task is required");
  }
  if (!projectId) {
    return { projectId: null, taskId: null };
  }

  const project = await db.first("SELECT id, is_active FROM projects WHERE id = ?", [projectId]) as
    | { id: number; is_active: number }
    | undefined;
  if (!project || !project.is_active) {
    throw new Error("Project not found");
  }

  const projectUsers = await db.all<{ user_id: number }>("SELECT user_id FROM project_users WHERE project_id = ?", [projectId]);
  if (projectUsers.length > 0 && !projectUsers.some((row) => row.user_id === userId)) {
    throw new Error("Project is not assigned to this user");
  }

  if (!taskId) {
    return { projectId, taskId: null };
  }

  const task = await db.first("SELECT id, is_active FROM tasks WHERE id = ?", [taskId]) as
    | { id: number; is_active: number }
    | undefined;
  if (!task || !task.is_active) {
    throw new Error("Task not found");
  }

  const projectTasks = await db.all<{ task_id: number }>("SELECT task_id FROM project_tasks WHERE project_id = ?", [projectId]);
  if (projectTasks.length > 0 && !projectTasks.some((row) => row.task_id === taskId)) {
    throw new Error("Task is not assigned to this project");
  }

  return { projectId, taskId };
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
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
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

async function enforceHolidayRecordRule(
  db: AppDatabase,
  companyId: string,
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
    startDate: string;
    endDate?: string | null;
  }
) {
  if (settings.allowRecordsOnHolidays || candidate.entryType !== "work") {
    return;
  }

  const normalizedEndDate = getRangeEndDay(candidate.startDate, candidate.endDate);
  const holiday = normalizedEndDate === candidate.startDate
    ? await settingsService.isPublicHoliday(db, companyId, candidate.startDate)
    : await settingsService.findPublicHolidayInRange(db, companyId, candidate.startDate, normalizedEndDate);

  if (holiday) {
    const holidayName =
      ("localName" in holiday && typeof holiday.localName === "string" && holiday.localName.trim().length > 0)
        ? holiday.localName
        : ("name" in holiday && typeof holiday.name === "string" && holiday.name.trim().length > 0)
          ? holiday.name
          : holiday.date;
    throw new Error(`Records on public holidays are disabled (${holidayName}, ${holiday.date})`);
  }
}

async function enforceWeekendRecordRule(
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
    startDate: string;
    endDate?: string | null;
  }
) {
  if (settings.allowRecordsOnWeekends || candidate.entryType !== "work") {
    return;
  }

  const normalizedEndDate = getRangeEndDay(candidate.startDate, candidate.endDate);
  const hasWeekendDay = enumerateLocalDays(candidate.startDate, normalizedEndDate).some((day) => isWeekendDay(day, settings.weekendDays));
  if (hasWeekendDay) {
    throw new Error("Records on weekends are disabled");
  }
}

function hasWeekendInRange(startDate: string, endDate: string | null | undefined, weekendDays: number[]) {
  const normalizedEndDate = getRangeEndDay(startDate, endDate);
  return enumerateLocalDays(startDate, normalizedEndDate).some((day) => isWeekendDay(day, weekendDays));
}

async function enforceEntryTypeSeparation(
  db: AppDatabase,
  companyId: string,
  userId: number,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
    startDate: string;
    endDate?: string | null;
  },
  excludeEntryId?: number,
) {
  const endDay = getRangeEndDay(candidate.startDate, candidate.endDate);
  if (candidate.entryType === "work") {
    const hasNonWorkEntry = await timeService.hasNonWorkEntryOnRange(
      db,
      companyId,
      userId,
      candidate.startDate,
      endDay,
      excludeEntryId,
    );
    if (hasNonWorkEntry) {
      throw new Error("Working time is not allowed on days that already contain vacation, sick leave, or time off in lieu");
    }
    return;
  }

  const hasWorkEntry = await timeService.hasWorkEntryOnRange(
    db,
    companyId,
    userId,
    candidate.startDate,
    endDay,
    excludeEntryId,
  );
  if (hasWorkEntry) {
    throw new Error("Leave and time-off records are not allowed on days that already contain working time");
  }

  const hasOtherNonWorkEntry = await timeService.hasNonWorkEntryOnRange(
    db,
    companyId,
    userId,
    candidate.startDate,
    endDay,
    excludeEntryId,
  );
  if (hasOtherNonWorkEntry) {
    throw new Error("Vacation, sick leave, and time off in lieu cannot overlap on the same day or range");
  }
}

async function enforceHolidayProbe(
  db: AppDatabase,
  companyId: string,
  settings: Awaited<ReturnType<typeof settingsService.getSettings>>,
  startDate: string,
  endDate?: string | null
) {
  const normalizedEndDate = getRangeEndDay(startDate, endDate);
  return normalizedEndDate === startDate
    ? await settingsService.isPublicHoliday(db, companyId, startDate)
    : await settingsService.findPublicHolidayInRange(db, companyId, startDate, normalizedEndDate);
}

function getPolicyErrorMessage(reason: ReturnType<typeof evaluateTimeEntryPolicy>["reason"]) {
  if (reason === "insert_limit") {
    return "Insert day limit reached";
  }
  if (reason === "edit_limit") {
    return "Edit day limit reached";
  }
  if (reason === "future_restricted") {
    return "Future work and sick leave records are disabled";
  }
  if (reason === "holiday_work_blocked") {
    return "Work records on public holidays are disabled";
  }
  if (reason === "weekend_work_blocked") {
    return "Work records on weekends are disabled";
  }
  return "Record rule violation";
}

async function enforceTimeOffInLieuBalance(
  db: AppDatabase,
  companyId: string,
  userId: number,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
    startDate: string;
    endDate?: string | null;
  },
  excludeEntryId?: number,
) {
  if (candidate.entryType !== "time_off_in_lieu") {
    return;
  }

  const requestedMinutes = await timeOffInLieuService.getRequestedMinutes(db, companyId, userId, candidate.startDate, candidate.endDate);
  const balance = await timeOffInLieuService.getBalance(db, companyId, userId, excludeEntryId);
  if (requestedMinutes > balance.availableMinutes) {
    throw new Error(
      `Time off in lieu balance is too low (requested ${requestedMinutes} minutes, available ${Math.max(0, balance.availableMinutes)} minutes)`,
    );
  }
}

async function enforceVacationBalance(
  db: AppDatabase,
  companyId: string,
  userId: number,
  candidate: {
    entryType: "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
    startDate: string;
    endDate?: string | null;
  },
  excludeEntryId?: number,
) {
  if (candidate.entryType !== "vacation") {
    return;
  }

  const referenceDay = (await settingsService.getBusinessNowSnapshot(db, companyId)).localDay;
  const requestedDays = await vacationBalanceService.getRequestedDays(db, companyId, userId, candidate.startDate, candidate.endDate);
  const balance = await vacationBalanceService.getBalance(db, companyId, userId, referenceDay, excludeEntryId);
  if (requestedDays > Math.max(0, balance.availableDays)) {
    throw new Error(
      `Vacation balance is too low (requested ${requestedDays.toFixed(2)} day(s), available ${Math.max(0, balance.availableDays).toFixed(2)} day(s))`,
    );
  }
}

async function enrichEntryWithDayMetrics(
  db: AppDatabase,
  companyId: string,
  entry: Awaited<ReturnType<typeof timeService.getEntryById>>,
  contracts?: Awaited<ReturnType<typeof userService.listUserContracts>>
) {
  const settings = await settingsService.getSettings(db, companyId);
  const resolvedContracts = contracts ?? await userService.listUserContracts(db, companyId, entry.userId);
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
    ...calculateLeaveCompensation(entry.entryType, startDay, endDay, holidaySet, resolvedContracts, settings.weekendDays)
  };
}

async function enrichEntriesWithDayMetrics(
  db: AppDatabase,
  companyId: string,
  entries: Awaited<ReturnType<typeof timeService.listEntries>>,
  contractsByUser?: Map<number, Awaited<ReturnType<typeof userService.listUserContracts>>>
) {
  return Promise.all(entries.map((entry) => enrichEntryWithDayMetrics(db, companyId, entry, contractsByUser?.get(entry.userId))));
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

async function buildDashboardSummary(db: AppDatabase, companyId: string, userId: number, targetDay?: string) {
  const settings = await settingsService.getSettings(db, companyId);
  const businessToday = (await settingsService.getBusinessNowSnapshot(db, companyId)).localDay;
  const focusDay = targetDay && /^\d{4}-\d{2}-\d{2}$/.test(targetDay) ? targetDay : businessToday;
  const fullWeekRange = getWeekRange(focusDay, settings.firstDayOfWeek);
  const fullMonthRange = getMonthRange(focusDay);
  const yearRange = { startDay: `${focusDay.slice(0, 4)}-01-01`, endDay: focusDay };
  const weekRange = { startDay: fullWeekRange.startDay, endDay: focusDay };
  const monthRange = { startDay: fullMonthRange.startDay, endDay: focusDay };
  const contracts = await userService.listUserContracts(db, companyId, userId);
  const allEntries = await timeService.listEntries(db, companyId, userId, {});
  const currentContract =
    contracts.find((contract) => contract.startDate <= focusDay && (contract.endDate === null || contract.endDate >= focusDay)) ?? null;
  const historyStartDay = [...contracts.map((contract) => contract.startDate), ...allEntries.map((entry) => entry.entryDate), focusDay].sort(
    (left, right) => left.localeCompare(right)
  )[0];
  const holidaySet = await getHolidaySetForRange(db, companyId, settings.country, historyStartDay, focusDay);

  const todayEntries = await timeService.listEntries(db, companyId, userId, { from: focusDay, to: focusDay });
  const weekEntries = await timeService.listEntries(db, companyId, userId, { from: weekRange.startDay, to: weekRange.endDay });
  const monthEntries = await timeService.listEntries(db, companyId, userId, { from: monthRange.startDay, to: monthRange.endDay });
  const yearEntries = await timeService.listEntries(db, companyId, userId, { from: yearRange.startDay, to: yearRange.endDay });
  const activeEntry = await timeService.getActiveEntry(db, companyId, userId);
  const contractsByUser = new Map([[userId, contracts]]);
  const todayRecordedMinutes = calculateRecordedMinutesForRange(todayEntries, focusDay, focusDay, settings, holidaySet, contracts);
  const weekRecordedMinutes = calculateRecordedMinutesForRange(weekEntries, weekRange.startDay, weekRange.endDay, settings, holidaySet, contracts);
  const monthRecordedMinutes = calculateRecordedMinutesForRange(monthEntries, monthRange.startDay, monthRange.endDay, settings, holidaySet, contracts);
  const yearRecordedMinutes = calculateRecordedMinutesForRange(yearEntries, yearRange.startDay, yearRange.endDay, settings, holidaySet, contracts);
  const weekExpectedMinutes = calculateExpectedContractMinutesForRange(weekRange.startDay, weekRange.endDay, holidaySet, contracts);
  const monthExpectedMinutes = calculateExpectedContractMinutesForRange(monthRange.startDay, monthRange.endDay, holidaySet, contracts);
  const yearExpectedMinutes = calculateExpectedContractMinutesForRange(yearRange.startDay, yearRange.endDay, holidaySet, contracts);
  const totalRecordedMinutes = calculateRecordedMinutesForRange(allEntries, historyStartDay, focusDay, settings, holidaySet, contracts);
  const totalExpectedMinutes = calculateExpectedContractMinutesForRange(historyStartDay, focusDay, holidaySet, contracts);
  const timeOffInLieuBalance = await timeOffInLieuService.getBalance(db, companyId, userId);
  const vacationBalance = await vacationBalanceService.getBalance(db, companyId, userId, businessToday);

  return {
    todayMinutes: todayRecordedMinutes,
    weekMinutes: weekRecordedMinutes,
    activeEntry: activeEntry ? await enrichEntryWithDayMetrics(db, companyId, activeEntry, contracts) : null,
    recentEntries: await enrichEntriesWithDayMetrics(db, companyId, allEntries.slice(0, 5), contractsByUser),
    contractStats: {
      currentContract: currentContract
        ? {
            hoursPerWeek: currentContract.hoursPerWeek,
            paymentPerHour: currentContract.paymentPerHour,
            startDate: currentContract.startDate,
            endDate: currentContract.endDate,
            schedule: currentContract.schedule
          }
        : null,
      totalBalanceMinutes: totalRecordedMinutes - totalExpectedMinutes,
      week: {
        expectedMinutes: weekExpectedMinutes,
        recordedMinutes: weekRecordedMinutes,
        balanceMinutes: weekRecordedMinutes - weekExpectedMinutes
      },
      month: {
        expectedMinutes: monthExpectedMinutes,
        recordedMinutes: monthRecordedMinutes,
        balanceMinutes: monthRecordedMinutes - monthExpectedMinutes
      },
      year: {
        expectedMinutes: yearExpectedMinutes,
        recordedMinutes: yearRecordedMinutes,
        balanceMinutes: yearRecordedMinutes - yearExpectedMinutes
      },
      vacation: vacationBalance,
      timeOffInLieu: timeOffInLieuBalance
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
    await enforceHolidayRecordRule(db, session.companyId, settings, {
      entryType: "work",
      startDate: snapshot.localDay,
      endDate: null
    });
    await enforceWeekendRecordRule(settings, {
      entryType: "work",
      startDate: snapshot.localDay,
      endDate: null
    });
    await enforceEntryTypeSeparation(db, session.companyId, session.userId, {
      entryType: "work",
      startDate: snapshot.localDay,
      endDate: null,
    });
    await enforceSingleRecordPerDay(db, session.companyId, session.userId, settings, snapshot.localDay);
    await enforceIntersectingRecords(db, session.companyId, session.userId, settings, {
      entryType: "work",
      startDate: snapshot.localDay,
      endDate: null,
      startTime: snapshot.instantIso,
      endTime: null
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Record rule violation" }, 400);
  }

  const customFieldValues = await validateCustomFields(db, session.companyId, "work", body.customFieldValues ?? {});
  let projectTaskSelection: { projectId: number | null; taskId: number | null };
  try {
    projectTaskSelection = await resolveProjectTaskSelection(db, session.companyId, session.userId, settings, {
      entryType: "work",
      projectId: body.projectId,
      taskId: body.taskId
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Record rule violation" }, 400);
  }

  return c.json({
    entry: await timeService.startTimer(db, session.companyId, session.userId, {
      ...body,
      ...projectTaskSelection,
      customFieldValues
    }, snapshot)
  });
});

timeRoutes.post("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = createManualEntrySchema.parse(await c.req.json());
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;

  let targetUserId: number;
  try {
    targetUserId = await resolveTargetUserId(db, session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const settings = await settingsService.getSettings(db, session.companyId);
  try {
    const holidayInRange = body.entryType === "work"
      ? Boolean(await enforceHolidayProbe(db, session.companyId, settings, body.startDate, body.endDate))
      : false;
    const weekendInRange = body.entryType === "work"
      ? hasWeekendInRange(body.startDate, body.endDate, settings.weekendDays)
      : false;
    const policy = evaluateTimeEntryPolicy({
      mode: "create",
      role: session.role,
      settings,
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      todayDay,
      hasHolidayInRange: holidayInRange,
      hasWeekendInRange: weekendInRange,
    });
    if (!policy.allowed) {
      throw new Error(getPolicyErrorMessage(policy.reason));
    }
    await enforceHolidayRecordRule(db, session.companyId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    await enforceWeekendRecordRule(settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    await enforceEntryTypeSeparation(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
    });
    await enforceSingleRecordPerDay(db, session.companyId, targetUserId, settings, body.startDate, body.endDate);
    await enforceIntersectingRecords(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime,
      endTime: body.endTime
    });
    await enforceTimeOffInLieuBalance(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    await enforceVacationBalance(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    body.customFieldValues = await validateCustomFields(db, session.companyId, body.entryType, body.customFieldValues);
    const projectTaskSelection = await resolveProjectTaskSelection(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      projectId: body.projectId,
      taskId: body.taskId
    });
    body.projectId = projectTaskSelection.projectId;
    body.taskId = projectTaskSelection.taskId;
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Insert day limit reached" }, 403);
  }

  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  const createdEntry = await timeService.createManualEntry(db, session.companyId, targetUserId, body);
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, createdEntry, await userService.listUserContracts(db, session.companyId, targetUserId)) });
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
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const entries = await timeService.listEntries(db, session.companyId, targetUserId, {
    from: c.req.query("from"),
    to: c.req.query("to")
  });
  return c.json({
    entries: await enrichEntriesWithDayMetrics(
      db,
      session.companyId,
      entries,
      new Map([[targetUserId, await userService.listUserContracts(db, session.companyId, targetUserId)]])
    )
  });
});

timeRoutes.get("/entry/:entryId", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const entry = await timeService.getEntryById(db, session.companyId, Number(c.req.param("entryId")));
  if (entry.userId !== targetUserId) {
    return c.json({ error: "Time entry not found" }, 404);
  }
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, entry, await userService.listUserContracts(db, session.companyId, targetUserId)) });
});

timeRoutes.get("/time-off-in-lieu/balance", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");

  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const excludeEntryIdValue = c.req.query("excludeEntryId");
  const excludeEntryId = excludeEntryIdValue ? Number(excludeEntryIdValue) : undefined;
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const balance = await timeOffInLieuService.getBalance(db, session.companyId, targetUserId, excludeEntryId);
  const requestedMinutes =
    startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? await timeOffInLieuService.getRequestedMinutes(db, session.companyId, targetUserId, startDate, endDate)
      : undefined;

  return c.json({
    balance,
    requestedMinutes,
  });
});

timeRoutes.get("/vacation/balance", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");

  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const excludeEntryIdValue = c.req.query("excludeEntryId");
  const excludeEntryId = excludeEntryIdValue ? Number(excludeEntryIdValue) : undefined;
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const referenceDay = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;
  const balance = await vacationBalanceService.getBalance(db, session.companyId, targetUserId, referenceDay, excludeEntryId);
  const requestedDays =
    startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? await vacationBalanceService.getRequestedDays(db, session.companyId, targetUserId, startDate, endDate)
      : undefined;

  return c.json({
    balance,
    requestedDays,
  });
});

timeRoutes.get("/sick-leave/summary", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");

  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const yearEnd = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;
  const yearStart = `${yearEnd.slice(0, 4)}-01-01`;
  const entries = await timeService.listEntries(db, session.companyId, targetUserId, { from: yearStart, to: yearEnd });
  const usedDays = entries
    .filter((entry) => entry.entryType === "sick_leave")
    .reduce((sum, entry) => sum + entry.totalDayCount, 0);

  return c.json({
    summary: {
      usedDays,
      elapsedDays: Math.max(0, enumerateLocalDays(yearStart, yearEnd).length),
    },
  });
});

timeRoutes.put("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = updateEntrySchema.parse(await c.req.json());
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, session.companyId)).localDay;

  let targetUserId: number;
  try {
    targetUserId = await resolveTargetUserId(db, session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  const settings = await settingsService.getSettings(db, session.companyId);
  try {
    const holidayInRange = body.entryType === "work"
      ? Boolean(await enforceHolidayProbe(db, session.companyId, settings, body.startDate, body.endDate))
      : false;
    const weekendInRange = body.entryType === "work"
      ? hasWeekendInRange(body.startDate, body.endDate, settings.weekendDays)
      : false;
    const policy = evaluateTimeEntryPolicy({
      mode: "edit",
      role: session.role,
      settings,
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      todayDay,
      hasHolidayInRange: holidayInRange,
      hasWeekendInRange: weekendInRange,
    });
    if (!policy.allowed) {
      throw new Error(getPolicyErrorMessage(policy.reason));
    }
    await enforceHolidayRecordRule(db, session.companyId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    await enforceWeekendRecordRule(settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    });
    await enforceEntryTypeSeparation(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
    }, body.entryId);
    await enforceSingleRecordPerDay(db, session.companyId, targetUserId, settings, body.startDate, body.endDate, body.entryId);
    await enforceIntersectingRecords(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime,
      endTime: body.endTime
    }, body.entryId);
    await enforceTimeOffInLieuBalance(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    }, body.entryId);
    await enforceVacationBalance(db, session.companyId, targetUserId, {
      entryType: body.entryType,
      startDate: body.startDate,
      endDate: body.endDate
    }, body.entryId);
    body.customFieldValues = await validateCustomFields(db, session.companyId, body.entryType, body.customFieldValues);
    const projectTaskSelection = await resolveProjectTaskSelection(db, session.companyId, targetUserId, settings, {
      entryType: body.entryType,
      projectId: body.projectId,
      taskId: body.taskId
    });
    body.projectId = projectTaskSelection.projectId;
    body.taskId = projectTaskSelection.taskId;
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Edit day limit reached" }, 403);
  }

  if (body.endDate && body.endDate < body.startDate) {
    return c.json({ error: "End date must be on or after start date" }, 400);
  }
  const updatedEntry = await timeService.updateEntry(db, session.companyId, targetUserId, body);
  return c.json({ entry: await enrichEntryWithDayMetrics(db, session.companyId, updatedEntry, await userService.listUserContracts(db, session.companyId, targetUserId)) });
});

timeRoutes.delete("/entry", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  const body = deleteEntrySchema.parse(await c.req.json());
  let targetUserId: number;
  try {
    targetUserId = await resolveTargetUserId(db, session, body.targetUserId);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }
  await timeService.deleteEntry(c.get("db"), session.companyId, targetUserId, body.entryId);
  return c.json({ success: true });
});

timeRoutes.get("/dashboard", async (c) => {
  const session = getCompanySession(c.get("session"));
  const db = c.get("db");
  let targetUserId: number;
  try {
    const rawTargetUserId = c.req.query("targetUserId");
    targetUserId = await resolveTargetUserId(db, session, rawTargetUserId ? Number(rawTargetUserId) : undefined);
  } catch {
    return c.json({ error: "Manager access required" }, 403);
  }

  return c.json({ summary: await buildDashboardSummary(c.get("db"), session.companyId, targetUserId, c.req.query("targetDay") ?? undefined) });
});
