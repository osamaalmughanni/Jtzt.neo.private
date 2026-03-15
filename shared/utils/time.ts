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
