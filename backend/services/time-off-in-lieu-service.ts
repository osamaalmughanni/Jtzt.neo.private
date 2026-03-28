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
  const rows = await db.all(
      `SELECT id, entry_date, end_date
       FROM time_entries
      WHERE user_id = ?
        AND entry_type = 'time_off_in_lieu'
        AND (? IS NULL OR id != ?)
      ORDER BY entry_date ASC, id ASC`,
    [userId, excludeEntryId ?? null, excludeEntryId ?? null],
  ) as TimeOffInLieuRow[];

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
  const rows = await db.all(
      `SELECT id, user_id, entry_type, entry_date, start_time, end_time
       FROM time_entries
      WHERE user_id = ?
        AND entry_type = 'work'
        AND end_time IS NOT NULL
        AND COALESCE(end_date, entry_date) <= ?
      ORDER BY entry_date ASC, start_time ASC, id ASC`,
    [userId, todayDay],
  ) as WorkEntryRow[];

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
