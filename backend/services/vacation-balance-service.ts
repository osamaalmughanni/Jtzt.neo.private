import { calculateLeaveCompensation } from "./time-entry-metrics-service";
import { settingsService } from "./settings-service";
import { timeService } from "./time-service";
import { userService } from "./user-service";
import type { AppDatabase } from "../runtime/types";
import type { UserContract } from "../../shared/types/models";
import { diffCalendarDays, formatLocalDay, parseLocalDay } from "../../shared/utils/time";

function addDays(day: string, amount: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  parsed.setDate(parsed.getDate() + amount);
  return formatLocalDay(parsed);
}

function addYears(day: string, amount: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  parsed.setFullYear(parsed.getFullYear() + amount);
  return formatLocalDay(parsed);
}

function addMonths(day: string, amount: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  parsed.setMonth(parsed.getMonth() + amount);
  return formatLocalDay(parsed);
}

function clampStart(left: string, right: string) {
  return left >= right ? left : right;
}

function clampEnd(left: string, right: string) {
  return left <= right ? left : right;
}

function roundWholeDays(value: number) {
  return Math.max(0, Math.round(value));
}

function floorWholeDays(value: number) {
  return Math.max(0, Math.floor(value));
}

function splitEmploymentPeriods(contracts: UserContract[]) {
  const sorted = [...contracts].sort((left, right) => left.startDate.localeCompare(right.startDate));
  const periods: Array<{ startDate: string; contracts: UserContract[] }> = [];

  for (const contract of sorted) {
    const current = periods[periods.length - 1];
    if (!current) {
      periods.push({ startDate: contract.startDate, contracts: [contract] });
      continue;
    }

    const previous = current.contracts[current.contracts.length - 1]!;
    const previousEnd = previous.endDate ?? contract.startDate;
    const continuedWithoutGap = contract.startDate <= addDays(previousEnd, 1);
    if (continuedWithoutGap) {
      current.contracts.push(contract);
      continue;
    }

    periods.push({ startDate: contract.startDate, contracts: [contract] });
  }

  return periods;
}

function getEmploymentPeriodForDay(contracts: UserContract[], day: string) {
  const periods = splitEmploymentPeriods(contracts);
  return periods.find((period) => {
    const lastContract = period.contracts[period.contracts.length - 1];
    const periodEnd = lastContract?.endDate ?? "9999-12-31";
    return period.startDate <= day && periodEnd >= day;
  }) ?? null;
}

function getCurrentContractForDay(contracts: UserContract[], day: string) {
  const activeContracts = contracts
    .filter((contract) => contract.startDate <= day && (contract.endDate ?? "9999-12-31") >= day)
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
  return activeContracts[0] ?? null;
}

function getYearBucketEntitlement(periodContracts: UserContract[], bucketStart: string, bucketEnd: string) {
  const totalBucketDays = diffCalendarDays(bucketEnd, bucketStart) + 1;
  if (totalBucketDays <= 0) {
    return 0;
  }

  let entitlement = 0;
  for (const contract of periodContracts) {
    const contractEnd = contract.endDate ?? bucketEnd;
    const overlapStart = clampStart(contract.startDate, bucketStart);
    const overlapEnd = clampEnd(contractEnd, bucketEnd);
    if (overlapStart > overlapEnd) {
      continue;
    }

    const overlapDays = diffCalendarDays(overlapEnd, overlapStart) + 1;
    entitlement += (contract.annualVacationDays * overlapDays) / totalBucketDays;
  }

  return roundWholeDays(entitlement);
}

function getEntitledDaysThroughDay(contracts: UserContract[], referenceDay: string) {
  if (contracts.length === 0) {
    return 0;
  }

  let totalEntitlement = 0;
  const periods = splitEmploymentPeriods(contracts);

  for (const period of periods) {
    let bucketIndex = 0;
    let bucketStart = period.startDate;

    while (bucketStart <= referenceDay) {
      const nextBucketStart = addYears(period.startDate, bucketIndex + 1);
      const bucketEnd = addDays(nextBucketStart, -1);
      const fullBucketEntitlement = getYearBucketEntitlement(period.contracts, bucketStart, bucketEnd);

      if (fullBucketEntitlement > 0) {
        const isFirstBucket = bucketIndex === 0;
        const sixMonthDate = addMonths(period.startDate, 6);
        const bucketReferenceEnd = clampEnd(referenceDay, bucketEnd);

        if (isFirstBucket && bucketReferenceEnd < sixMonthDate) {
          const servedDays = diffCalendarDays(bucketReferenceEnd, bucketStart) + 1;
          const bucketLength = diffCalendarDays(bucketEnd, bucketStart) + 1;
          totalEntitlement += floorWholeDays((fullBucketEntitlement * servedDays) / bucketLength);
        } else {
          totalEntitlement += fullBucketEntitlement;
        }
      }

      bucketIndex += 1;
      bucketStart = nextBucketStart;
    }
  }

  return totalEntitlement;
}

async function getHolidaySetForRange(db: AppDatabase, companyId: string, startDay: string, endDay: string) {
  const settings = await settingsService.getSettings(db, companyId);
  const years = new Set<number>();
  let year = Number(startDay.slice(0, 4));
  const finalYear = Number(endDay.slice(0, 4));
  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }

  const responses = await Promise.all(
    Array.from(years).map((currentYear) => settingsService.getPublicHolidays(db, companyId, settings.country, currentYear)),
  );

  return new Set(responses.flatMap((response) => response.holidays).map((holiday) => holiday.date));
}

async function getUsedVacationDaysThroughDay(
  db: AppDatabase,
  companyId: string,
  userId: number,
  contracts: UserContract[],
  _referenceDay: string,
  excludeEntryId?: number,
) {
  const settings = await settingsService.getSettings(db, companyId);
  const entries = (await timeService.listEntries(db, companyId, userId, {}))
    .filter((entry: Awaited<ReturnType<typeof timeService.listEntries>>[number]) => entry.entryType === "vacation" && (excludeEntryId ? entry.id !== excludeEntryId : true));

  if (entries.length === 0) {
    return 0;
  }

  const firstEntryDay = entries.reduce(
    (earliest: string, entry: (typeof entries)[number]) => (entry.entryDate < earliest ? entry.entryDate : earliest),
    entries[0]!.entryDate
  );
  const lastEntryDay = entries.reduce(
    (latest: string, entry: (typeof entries)[number]) => ((entry.endDate ?? entry.entryDate) > latest ? (entry.endDate ?? entry.entryDate) : latest),
    entries[0]!.endDate ?? entries[0]!.entryDate,
  );
  const holidaySet = await getHolidaySetForRange(db, companyId, firstEntryDay, lastEntryDay);

  let usedDays = 0;
  for (const entry of entries) {
    const endDay = entry.endDate ?? entry.entryDate;
    usedDays += calculateLeaveCompensation(
      "vacation",
      entry.entryDate,
      endDay,
      holidaySet,
      contracts,
      settings.weekendDays
    ).effectiveDayCount;
  }

  return usedDays;
}

function getCurrentWorkYearMeta(contracts: UserContract[], referenceDay: string) {
  const period = getEmploymentPeriodForDay(contracts, referenceDay);
  if (!period) {
    return {
      currentWorkYearStart: null,
      currentWorkYearEnd: null,
      nextFullEntitlementDate: null,
      inInitialAccrualPhase: false,
      currentContractVacationDays: null,
    };
  }

  let bucketIndex = 0;
  let bucketStart = period.startDate;
  while (bucketStart <= referenceDay) {
    const nextBucketStart = addYears(period.startDate, bucketIndex + 1);
    const bucketEnd = addDays(nextBucketStart, -1);
    if (referenceDay >= bucketStart && referenceDay <= bucketEnd) {
      const currentContract = getCurrentContractForDay(period.contracts, referenceDay);
      const sixMonthDate = addMonths(period.startDate, 6);
      const inInitialAccrualPhase = bucketIndex === 0 && referenceDay < sixMonthDate;
      return {
        currentWorkYearStart: bucketStart,
        currentWorkYearEnd: bucketEnd,
        nextFullEntitlementDate: inInitialAccrualPhase ? sixMonthDate : nextBucketStart,
        inInitialAccrualPhase,
        currentContractVacationDays: currentContract?.annualVacationDays ?? null,
      };
    }
    bucketIndex += 1;
    bucketStart = nextBucketStart;
  }

  return {
    currentWorkYearStart: null,
    currentWorkYearEnd: null,
    nextFullEntitlementDate: null,
    inInitialAccrualPhase: false,
    currentContractVacationDays: null,
  };
}

export const vacationBalanceService = {
  async getBalance(db: AppDatabase, companyId: string, userId: number, referenceDay: string, excludeEntryId?: number) {
    const contracts = await userService.listUserContracts(db, companyId, userId);
    const entitledDays = getEntitledDaysThroughDay(contracts, referenceDay);
    const usedDays = await getUsedVacationDaysThroughDay(db, companyId, userId, contracts, referenceDay, excludeEntryId);
    const availableDays = Math.max(0, entitledDays - usedDays);

    return {
      entitledDays,
      usedDays,
      availableDays,
    };
  },

  async getRequestedDays(db: AppDatabase, companyId: string, userId: number, startDate: string, endDate?: string | null) {
    const rangeEnd = endDate && endDate >= startDate ? endDate : startDate;
    const contracts = await userService.listUserContracts(db, companyId, userId);
    const settings = await settingsService.getSettings(db, companyId);
    const holidaySet = await getHolidaySetForRange(db, companyId, startDate, rangeEnd);
    return calculateLeaveCompensation(
      "vacation",
      startDate,
      rangeEnd,
      holidaySet,
      contracts,
      settings.weekendDays
    ).effectiveDayCount;
  },

  async getReportOverview(db: AppDatabase, companyId: string, userId: number, referenceDay: string, excludeEntryId?: number) {
    const contracts = await userService.listUserContracts(db, companyId, userId);
    const balance = await this.getBalance(db, companyId, userId, referenceDay, excludeEntryId);
    const workYearMeta = getCurrentWorkYearMeta(contracts, referenceDay);

    return {
      ...balance,
      ...workYearMeta,
    };
  },
};
