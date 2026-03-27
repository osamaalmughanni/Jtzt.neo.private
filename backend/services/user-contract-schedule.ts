import type { UserContractInput } from "../../shared/types/api";
import type { ContractWeekday, UserContract, UserContractScheduleBlock, UserContractScheduleDay } from "../../shared/types/models";
import { diffClockTimeMinutes, getIsoDayOfWeek, isValidClockTime } from "../../shared/utils/time";

const CONTRACT_WEEKDAYS: ContractWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";

function roundHours(totalMinutes: number) {
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function buildScheduleBlock(startTime: string, endTime: string): UserContractScheduleBlock {
  const minutes = diffClockTimeMinutes(startTime, endTime);
  if (minutes === null) {
    throw new Error("Contract block end time must be after the start time");
  }

  return {
    startTime,
    endTime,
    minutes
  };
}

function buildScheduleDay(weekday: ContractWeekday, blocks: UserContractScheduleBlock[]): UserContractScheduleDay {
  const totalMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);
  return {
    weekday,
    isWorkingDay: blocks.length > 0,
    blocks,
    minutes: totalMinutes
  };
}

export function createDefaultContractSchedule(): UserContractScheduleDay[] {
  return CONTRACT_WEEKDAYS.map((weekday) =>
    weekday <= 5
      ? buildScheduleDay(weekday, [buildScheduleBlock(DEFAULT_START_TIME, DEFAULT_END_TIME)])
      : buildScheduleDay(weekday, [])
  );
}

function normalizeScheduleBlocks(
  blocks: UserContractScheduleBlock[],
  onError: (message: string) => never,
  lenient = false
) {
  const normalized = blocks
    .map((block) => ({
      startTime: block.startTime ?? "",
      endTime: block.endTime ?? "",
      minutes: Number(block.minutes ?? 0)
    }))
    .filter((block) => block.startTime.length > 0 || block.endTime.length > 0)
    .sort((left, right) => left.startTime.localeCompare(right.startTime));

  const resolved: Array<{ startTime: string; endTime: string; minutes: number }> = [];
  let previousEnd = "";

  for (const block of normalized) {
    if (!isValidClockTime(block.startTime) || !isValidClockTime(block.endTime)) {
      if (lenient) {
        continue;
      }
      onError("Working day blocks require valid start and end times");
    }

    const minutes = diffClockTimeMinutes(block.startTime, block.endTime);
    if (minutes === null) {
      if (lenient) {
        continue;
      }
      onError("Working day blocks must end after they start");
    }

    if (previousEnd && block.startTime < previousEnd) {
      if (lenient) {
        continue;
      }
      onError("Working day blocks cannot overlap");
    }

    resolved.push({
      startTime: block.startTime,
      endTime: block.endTime,
      minutes
    });
    previousEnd = block.endTime;
  }

  if (resolved.length === 0) {
    if (lenient) {
      return [];
    }
    onError("Working days require at least one time block");
  }

  return resolved;
}

export function normalizeContractSchedule(
  schedule: UserContractScheduleDay[],
  onError: (message: string) => never,
  lenient = false
): { schedule: UserContractScheduleDay[]; hoursPerWeek: number } {
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    onError("Contract schedule must contain exactly seven days");
  }

  const normalized = [...schedule]
    .map((day) => ({
      weekday: day.weekday,
      isWorkingDay: Boolean(day.isWorkingDay),
      blocks: Array.isArray(day.blocks)
        ? day.blocks.map((block) => ({
            startTime: block.startTime ?? "",
            endTime: block.endTime ?? "",
            minutes: Number(block.minutes ?? 0)
          }))
        : []
    }))
    .sort((left, right) => left.weekday - right.weekday);

  for (let index = 0; index < CONTRACT_WEEKDAYS.length; index += 1) {
    const day = normalized[index];
    const expectedWeekday = CONTRACT_WEEKDAYS[index];
    if (!day || day.weekday !== expectedWeekday) {
      onError("Contract schedule weekdays must cover Monday to Sunday exactly once");
    }

    const normalizedBlocks = day.isWorkingDay ? normalizeScheduleBlocks(day.blocks, onError, lenient) : [];

    if (!day.isWorkingDay) {
      day.blocks = [];
      continue;
    }

    day.blocks = normalizedBlocks;
  }

  const finalized = normalized.map((day) => ({
    weekday: day.weekday,
    isWorkingDay: day.blocks.length > 0,
    blocks: day.blocks,
    minutes: day.blocks.reduce((sum, block) => sum + block.minutes, 0)
  }));

  const totalMinutes = finalized.reduce((sum, day) => sum + day.minutes, 0);
  return {
    schedule: finalized,
    hoursPerWeek: roundHours(totalMinutes)
  };
}

export function buildContractInputWithDerivedHours(
  contract: UserContractInput,
  onError: (message: string) => never
): UserContractInput {
  const normalized = normalizeContractSchedule(contract.schedule, onError);
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
  annual_vacation_days?: number | null;
  created_at: string;
}, schedule: Array<{
  weekday: number;
  block_order: number;
  start_time: string;
  end_time: string;
  minutes: number;
}>): UserContract {
  const scheduleByWeekday = new Map<ContractWeekday, UserContractScheduleBlock[]>();
  for (const weekday of CONTRACT_WEEKDAYS) {
    scheduleByWeekday.set(weekday, []);
  }

  const sortedBlocks = [...schedule].sort((left, right) =>
    left.weekday - right.weekday || left.block_order - right.block_order || left.start_time.localeCompare(right.start_time)
  );

  for (const rowBlock of sortedBlocks) {
    const weekday = rowBlock.weekday as ContractWeekday;
    const blocks = scheduleByWeekday.get(weekday);
    if (!blocks) {
      continue;
    }
    blocks.push({
      startTime: rowBlock.start_time,
      endTime: rowBlock.end_time,
      minutes: Number(rowBlock.minutes ?? 0)
    });
  }

  const normalizedSchedule = CONTRACT_WEEKDAYS.map((weekday) =>
    buildScheduleDay(weekday, scheduleByWeekday.get(weekday) ?? [])
  );
  const normalized = normalizeContractSchedule(
    normalizedSchedule,
    (message) => {
      throw new Error(message);
    },
    true
  );

  return {
    id: row.id,
    userId: row.user_id,
    hoursPerWeek: normalized.hoursPerWeek,
    startDate: row.start_date,
    endDate: row.end_date,
    paymentPerHour: row.payment_per_hour,
    annualVacationDays: Number(row.annual_vacation_days ?? 25),
    schedule: normalized.schedule,
    createdAt: row.created_at
  };
}

export function getContractScheduledMinutesForDay(contract: UserContract, day: string) {
  const weekday = getIsoDayOfWeek(day);
  if (!weekday) {
    return 0;
  }

  const scheduleDay = contract.schedule.find((entry) => entry.weekday === weekday);
  return scheduleDay ? scheduleDay.blocks.reduce((sum, block) => sum + block.minutes, 0) : 0;
}
