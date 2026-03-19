import type { CompanySettings, TimeEntryType, UserContract } from "../../shared/types/models";
import { diffMinutes, enumerateLocalDays, formatLocalDay, parseLocalDay, isWeekendDay } from "../../shared/utils/time";
import { getContractScheduledMinutesForDay } from "./user-contract-schedule";

type ContractAwareEntry = {
  entryType: TimeEntryType;
  entryDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

function resolveContractForDay(contracts: UserContract[], day: string) {
  let match: UserContract | null = null;

  for (const contract of contracts) {
    if (contract.startDate <= day && (contract.endDate === null || contract.endDate >= day)) {
      if (!match || contract.startDate >= match.startDate) {
        match = contract;
      }
    }
  }

  return match;
}

function getContractDailyMinutes(contract: UserContract, day: string) {
  return Math.max(0, getContractScheduledMinutesForDay(contract, day));
}

export function calculateWorkDurationMinutes(startTime: string | null, endTime: string | null, settings: Pick<CompanySettings, "autoBreakAfterMinutes" | "autoBreakDurationMinutes">) {
  const rawMinutes = diffMinutes(startTime ?? "", endTime);
  if (settings.autoBreakAfterMinutes <= 0 || settings.autoBreakDurationMinutes <= 0) {
    return rawMinutes;
  }

  if (rawMinutes < settings.autoBreakAfterMinutes) {
    return rawMinutes;
  }

  return Math.max(0, rawMinutes - settings.autoBreakDurationMinutes);
}

export function calculateWorkCostAmount(
  startTime: string | null,
  endTime: string | null,
  day: string,
  settings: Pick<CompanySettings, "autoBreakAfterMinutes" | "autoBreakDurationMinutes">,
  contracts: UserContract[],
) {
  const contract = resolveContractForDay(contracts, day);
  if (!contract) {
    return 0;
  }

  const durationMinutes = calculateWorkDurationMinutes(startTime, endTime, settings);
  return Math.round(((durationMinutes / 60) * contract.paymentPerHour) * 100) / 100;
}

export function calculateLeaveCompensation(
  entryType: TimeEntryType,
  startDay: string,
  endDay: string,
  holidayDays: Set<string>,
  contracts: UserContract[],
) {
  const days = enumerateLocalDays(startDay, endDay);
  let effectiveDayCount = 0;
  let excludedHolidayCount = 0;
  let excludedWeekendCount = 0;

  if (entryType === "work") {
    return {
      totalDayCount: days.length,
      effectiveDayCount,
      excludedHolidayCount,
      excludedWeekendCount,
      durationMinutes: 0,
      costAmount: 0,
    };
  }

  let durationMinutes = 0;
  let costAmount = 0;

  for (const day of days) {
    const holiday = holidayDays.has(day);
    if (holiday) {
      excludedHolidayCount += 1;
      continue;
    }

    const contract = resolveContractForDay(contracts, day);
    if (!contract) {
      if (isWeekendDay(day)) {
        excludedWeekendCount += 1;
      }
      continue;
    }

    const dailyMinutes = getContractDailyMinutes(contract, day);
    if (dailyMinutes <= 0) {
      if (isWeekendDay(day)) {
        excludedWeekendCount += 1;
      }
      continue;
    }

    effectiveDayCount += 1;
    durationMinutes += dailyMinutes;
    costAmount += (dailyMinutes / 60) * contract.paymentPerHour;
  }

  return {
    totalDayCount: days.length,
    effectiveDayCount,
    excludedHolidayCount,
    excludedWeekendCount,
    durationMinutes,
    costAmount: Math.round(costAmount * 100) / 100,
  };
}

export function getExpectedContractMinutesForDay(day: string, holidayDays: Set<string>, contracts: UserContract[]) {
  if (holidayDays.has(day)) {
    return 0;
  }

  const contract = resolveContractForDay(contracts, day);
  if (!contract) {
    return 0;
  }

  return getContractDailyMinutes(contract, day);
}

export function entryOverlapsRange(entry: Pick<ContractAwareEntry, "entryDate" | "endDate">, startDay: string, endDay: string) {
  const entryEndDay = entry.endDate ?? entry.entryDate;
  return entry.entryDate <= endDay && entryEndDay >= startDay;
}

export function calculateExpectedContractMinutesForRange(startDay: string, endDay: string, holidayDays: Set<string>, contracts: UserContract[]) {
  return enumerateDayRange(startDay, endDay).reduce((sum, day) => sum + getExpectedContractMinutesForDay(day, holidayDays, contracts), 0);
}

export function calculateRecordedMinutesForRange(
  entries: ContractAwareEntry[],
  startDay: string,
  endDay: string,
  settings: Pick<CompanySettings, "autoBreakAfterMinutes" | "autoBreakDurationMinutes">,
  holidayDays: Set<string>,
  contracts: UserContract[]
) {
  return entries.reduce((sum, entry) => {
    if (!entryOverlapsRange(entry, startDay, endDay)) {
      return sum;
    }

    if (entry.entryType === "work") {
      return sum + calculateWorkDurationMinutes(entry.startTime, entry.endTime, settings);
    }

    const clampedStart = entry.entryDate < startDay ? startDay : entry.entryDate;
    const entryEndDay = entry.endDate ?? entry.entryDate;
    const clampedEnd = entryEndDay > endDay ? endDay : entryEndDay;
    return sum + calculateLeaveCompensation(entry.entryType, clampedStart, clampedEnd, holidayDays, contracts).durationMinutes;
  }, 0);
}

export function enumerateDayRange(startDay: string, endDay: string) {
  return enumerateLocalDays(startDay, endDay);
}

export function getMonthRange(day: string) {
  const parsed = parseLocalDay(day) ?? new Date();
  return {
    startDay: formatLocalDay(new Date(parsed.getFullYear(), parsed.getMonth(), 1)),
    endDay: formatLocalDay(new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0)),
  };
}

export function getWeekRange(day: string, firstDayOfWeek: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  const currentWeekday = parsed.getDay();
  const deltaToStart = (currentWeekday - firstDayOfWeek + 7) % 7;
  const start = new Date(parsed);
  start.setDate(parsed.getDate() - deltaToStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    startDay: formatLocalDay(start),
    endDay: formatLocalDay(end),
  };
}
