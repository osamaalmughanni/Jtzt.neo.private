import { and, asc, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { timeEntries } from "../db/schema";
import { calculateLeaveCompensation } from "./time-entry-metrics-service";
import { buildOvertimeReportMeta, getTimeOffInLieuCreditMinutes } from "./overtime-report-service";
import { settingsService } from "./settings-service";
import { userService } from "./user-service";
import type { AppDatabase } from "../runtime/types";

type WorkEntryRow = {
  id: number;
  user_id: number;
  entry_type: "work";
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
};

type TimeOffInLieuRow = {
  id: number;
  entry_date: string;
  end_date: string | null;
};

async function getHolidaySetForRange(db: AppDatabase, companyId: string, country: string, startDate: string, endDate: string) {
  const holidaySet = new Set<string>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));
  while (year <= finalYear) {
    const response = await settingsService.getPublicHolidays(db, companyId, country, year);
    for (const holiday of response.holidays) {
      holidaySet.add(holiday.date);
    }
    year += 1;
  }
  return holidaySet;
}

async function getBookedMinutes(
  db: AppDatabase,
  companyId: string,
  userId: number,
  excludeEntryId?: number,
) {
  const rows = await db.orm.select({
    id: timeEntries.id,
    entry_date: timeEntries.entryDate,
    end_date: timeEntries.endDate,
  }).from(timeEntries).where(and(
    eq(timeEntries.userId, userId),
    eq(timeEntries.entryType, "time_off_in_lieu"),
    excludeEntryId ? ne(timeEntries.id, excludeEntryId) : undefined
  )).orderBy(asc(timeEntries.entryDate), asc(timeEntries.id)) as TimeOffInLieuRow[];

  if (rows.length === 0) {
    return 0;
  }

  const settings = await settingsService.getSettings(db, companyId);
  const contracts = await userService.listUserContracts(db, companyId, userId);
  const startDate = rows[0].entry_date;
  const endDate = rows.reduce((latest, row) => {
    const rowEnd = row.end_date ?? row.entry_date;
    return rowEnd > latest ? rowEnd : latest;
  }, rows[0].end_date ?? rows[0].entry_date);
  const holidaySet = await getHolidaySetForRange(db, companyId, settings.country, startDate, endDate);

  return rows.reduce((sum, row) => {
    const rowEnd = row.end_date ?? row.entry_date;
    return sum + calculateLeaveCompensation(
      "time_off_in_lieu",
      row.entry_date,
      rowEnd,
      holidaySet,
      contracts,
      settings.weekendDays
    ).durationMinutes;
  }, 0);
}

async function getEarnedMinutes(db: AppDatabase, companyId: string, userId: number) {
  const settings = await settingsService.getSettings(db, companyId);
  const todayDay = (await settingsService.getBusinessNowSnapshot(db, companyId)).localDay;
  const rows = await db.orm.select({
    id: timeEntries.id,
    user_id: timeEntries.userId,
    entry_type: timeEntries.entryType,
    entry_date: timeEntries.entryDate,
    start_time: timeEntries.startTime,
    end_time: timeEntries.endTime,
  }).from(timeEntries).where(and(
    eq(timeEntries.userId, userId),
    eq(timeEntries.entryType, "work"),
    isNotNull(timeEntries.endTime),
    or(lte(timeEntries.endDate, todayDay), and(isNull(timeEntries.endDate), lte(timeEntries.entryDate, todayDay)))
  )).orderBy(asc(timeEntries.entryDate), asc(timeEntries.startTime), asc(timeEntries.id)) as WorkEntryRow[];

  if (rows.length === 0) {
    return 0;
  }

  const contracts = await userService.listUserContracts(db, companyId, userId);
  const metaByEntryId = buildOvertimeReportMeta(rows, settings, new Map([[userId, contracts]]));

  return rows.reduce((sum, row) => {
    const meta = metaByEntryId.get(row.id);
    if (!meta) {
      return sum;
    }
    return sum + getTimeOffInLieuCreditMinutes(meta, settings);
  }, 0);
}

export const timeOffInLieuService = {
  async getBalance(db: AppDatabase, companyId: string, userId: number, excludeEntryId?: number) {
    const [earnedMinutes, bookedMinutes] = await Promise.all([
      getEarnedMinutes(db, companyId, userId),
      getBookedMinutes(db, companyId, userId, excludeEntryId),
    ]);

    return {
      earnedMinutes,
      bookedMinutes,
      availableMinutes: earnedMinutes - bookedMinutes,
    };
  },

  async getRequestedMinutes(
    db: AppDatabase,
    companyId: string,
    userId: number,
    startDate: string,
    endDate?: string | null,
  ) {
    const settings = await settingsService.getSettings(db, companyId);
    const contracts = await userService.listUserContracts(db, companyId, userId);
    const resolvedEndDate = endDate && endDate >= startDate ? endDate : startDate;
    const holidaySet = await getHolidaySetForRange(db, companyId, settings.country, startDate, resolvedEndDate);
    return calculateLeaveCompensation(
      "time_off_in_lieu",
      startDate,
      resolvedEndDate,
      holidaySet,
      contracts,
      settings.weekendDays
    ).durationMinutes;
  },
};
