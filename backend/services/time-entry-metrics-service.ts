import type { TimeEntryType, UserContract } from "../../shared/types/models";
import { countEffectiveLeaveDays, enumerateLocalDays, isWeekendDay } from "../../shared/utils/time";

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
