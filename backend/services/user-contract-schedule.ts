import type { UserContractInput } from "../../shared/types/api";
import type { ContractWeekday, UserContract, UserContractScheduleDay } from "../../shared/types/models";
import { diffClockTimeMinutes, getIsoDayOfWeek, isValidClockTime } from "../../shared/utils/time";

const CONTRACT_WEEKDAYS: ContractWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_START_TIME = "09:00";

function roundHours(totalMinutes: number) {
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function buildLegacyWeekdayMinutes(hoursPerWeek: number) {
  return Math.max(0, Math.round((hoursPerWeek * 60) / 5));
}

function buildScheduleDay(weekday: ContractWeekday, isWorkingDay: boolean, startTime: string | null, endTime: string | null): UserContractScheduleDay {
  const minutes = isWorkingDay && startTime && endTime ? diffClockTimeMinutes(startTime, endTime) ?? 0 : 0;
  return {
    weekday,
    isWorkingDay,
    startTime: isWorkingDay ? startTime : null,
    endTime: isWorkingDay ? endTime : null,
    minutes
  };
}

export function createDefaultContractSchedule(): UserContractScheduleDay[] {
  return CONTRACT_WEEKDAYS.map((weekday) => ({
    weekday,
    isWorkingDay: weekday <= 5,
    startTime: weekday <= 5 ? "09:00" : null,
    endTime: weekday <= 5 ? "17:00" : null,
    minutes: weekday <= 5 ? 480 : 0
  }));
}

export function createLegacyContractSchedule(hoursPerWeek: number): UserContractScheduleDay[] {
  const weekdayMinutes = buildLegacyWeekdayMinutes(hoursPerWeek);
  const endHour = Math.floor((9 * 60 + weekdayMinutes) / 60).toString().padStart(2, "0");
  const endMinute = ((9 * 60 + weekdayMinutes) % 60).toString().padStart(2, "0");
  const endTime = weekdayMinutes > 0 ? `${endHour}:${endMinute}` : null;

  return CONTRACT_WEEKDAYS.map((weekday) =>
    buildScheduleDay(
      weekday,
      weekday <= 5 && weekdayMinutes > 0,
      weekday <= 5 && weekdayMinutes > 0 ? DEFAULT_START_TIME : null,
      weekday <= 5 && weekdayMinutes > 0 ? endTime : null
    )
  );
}

export function normalizeContractSchedule(
  schedule: UserContractScheduleDay[],
  onError: (message: string) => never
): { schedule: UserContractScheduleDay[]; hoursPerWeek: number } {
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    onError("Contract schedule must contain exactly seven days");
  }

  const normalized = [...schedule]
    .map((day) => ({
      weekday: day.weekday,
      isWorkingDay: Boolean(day.isWorkingDay),
      startTime: day.startTime ?? null,
      endTime: day.endTime ?? null,
      minutes: Number(day.minutes ?? 0)
    }))
    .sort((left, right) => left.weekday - right.weekday);

  for (let index = 0; index < CONTRACT_WEEKDAYS.length; index += 1) {
    const day = normalized[index];
    const expectedWeekday = CONTRACT_WEEKDAYS[index];
    if (!day || day.weekday !== expectedWeekday) {
      onError("Contract schedule weekdays must cover Monday to Sunday exactly once");
    }

    if (!day.isWorkingDay) {
      day.startTime = null;
      day.endTime = null;
      day.minutes = 0;
      continue;
    }

    if (!day.startTime || !day.endTime || !isValidClockTime(day.startTime) || !isValidClockTime(day.endTime)) {
      onError("Working days require a valid start and end time");
    }

    const minutes = diffClockTimeMinutes(day.startTime, day.endTime);
    if (minutes === null) {
      onError("Contract end time must be after the start time on the same day");
    }

    day.minutes = minutes;
  }

  const totalMinutes = normalized.reduce((sum, day) => sum + day.minutes, 0);
  return {
    schedule: normalized,
    hoursPerWeek: roundHours(totalMinutes)
  };
}

export function buildContractInputWithDerivedHours(
  contract: UserContractInput,
  onError: (message: string) => never
): UserContractInput {
  const normalized = normalizeContractSchedule(contract.schedule?.length === 7 ? contract.schedule : createLegacyContractSchedule(contract.hoursPerWeek), onError);
  return {
    ...contract,
    hoursPerWeek: normalized.hoursPerWeek,
    schedule: normalized.schedule
  };
}

export function buildUserContract(row: {
  id: number;
  user_id: number;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
  payment_per_hour: number;
  created_at: string;
}, schedule: UserContractScheduleDay[]): UserContract {
  const normalized = normalizeContractSchedule(schedule.length === 7 ? schedule : createLegacyContractSchedule(row.hours_per_week), (message) => {
    throw new Error(message);
  });

  return {
    id: row.id,
    userId: row.user_id,
    hoursPerWeek: normalized.hoursPerWeek,
    startDate: row.start_date,
    endDate: row.end_date,
    paymentPerHour: row.payment_per_hour,
    schedule: normalized.schedule,
    createdAt: row.created_at
  };
}

export function getContractScheduledMinutesForDay(contract: UserContract, day: string) {
  const weekday = getIsoDayOfWeek(day);
  if (!weekday) {
    return 0;
  }

  return contract.schedule.find((scheduleDay) => scheduleDay.weekday === weekday)?.minutes ?? 0;
}
