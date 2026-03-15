import type { CompanySettings, TimeEntryType, UserContract } from "../../shared/types/models";
import { countEffectiveLeaveDays, diffMinutes, enumerateLocalDays, formatLocalDay, isWeekendDay, parseLocalDay } from "../../shared/utils/time";

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

function getContractDailyMinutes(contract: UserContract) {
  return Math.max(0, Math.round((contract.hoursPerWeek / 5) * 60));
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
  const baseMetrics = countEffectiveLeaveDays(startDay, endDay, holidayDays);

  if (entryType === "work") {
    return {
      ...baseMetrics,
      durationMinutes: 0,
      costAmount: 0,
    };
  }

  let durationMinutes = 0;
  let costAmount = 0;

  for (const day of enumerateLocalDays(startDay, endDay)) {
    if (holidayDays.has(day) || isWeekendDay(day)) {
      continue;
    }

    const contract = resolveContractForDay(contracts, day);
    if (!contract) {
      continue;
    }

    const dailyMinutes = getContractDailyMinutes(contract);
    durationMinutes += dailyMinutes;
    costAmount += (dailyMinutes / 60) * contract.paymentPerHour;
  }

  return {
    ...baseMetrics,
    durationMinutes,
    costAmount: Math.round(costAmount * 100) / 100,
  };
}

export function getExpectedContractMinutesForDay(day: string, holidayDays: Set<string>, contracts: UserContract[]) {
  if (holidayDays.has(day) || isWeekendDay(day)) {
    return 0;
  }

  const contract = resolveContractForDay(contracts, day);
  if (!contract) {
    return 0;
  }

  return getContractDailyMinutes(contract);
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
