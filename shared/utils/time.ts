export function diffMinutes(startIso: string, endIso: string | null): number {
  const endTime = endIso ? new Date(endIso).getTime() : Date.now();
  const startTime = new Date(startIso).getTime();
  return Math.max(0, Math.round((endTime - startTime) / 60000));
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(year, month - 1, day);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

export function diffCalendarDays(leftDay: string, rightDay: string): number {
  const left = parseLocalDay(leftDay);
  const right = parseLocalDay(rightDay);
  if (!left || !right) {
    return 0;
  }

  const leftUtc = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const rightUtc = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((leftUtc - rightUtc) / 86400000);
}

export function startOfDayIso(date = new Date()): string {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

export function startOfWeekIso(date = new Date()): string {
  const value = new Date(date);
  const weekday = value.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  value.setDate(value.getDate() + offset);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}
