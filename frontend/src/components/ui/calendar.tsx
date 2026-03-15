import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocalDay } from "@shared/utils/time";
import { Button } from "@/components/ui/button";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { formatCompanyMonthYear } from "@/lib/locale-format";
import { cn } from "@/lib/utils";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function Calendar({
  selected,
  onSelect,
  firstDayOfWeek = 1,
  className,
  locale = "en-GB",
  holidayDates = [],
  dayStates = {},
  onMonthChange
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  firstDayOfWeek?: number;
  className?: string;
  locale?: string;
  holidayDates?: string[];
  dayStates?: Record<string, "work" | "sick_leave" | "vacation" | "mixed">;
  onMonthChange?: (date: Date) => void;
}) {
  const { t } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const [viewDate, setViewDate] = useState(startOfMonth(selected));
  const selectedMonthKey = `${selected.getFullYear()}-${selected.getMonth()}`;

  useEffect(() => {
    setViewDate(startOfMonth(selected));
  }, [selectedMonthKey]);

  useEffect(() => {
    onMonthChange?.(viewDate);
  }, [onMonthChange, viewDate]);

  const days = useMemo(() => {
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);
    const leading = (first.getDay() - firstDayOfWeek + 7) % 7;
    const result: Array<Date | null> = [];

    for (let index = 0; index < leading; index += 1) result.push(null);
    for (let day = 1; day <= last.getDate(); day += 1) {
      result.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [firstDayOfWeek, viewDate]);

  const weekdayLabels = useMemo(() => {
    const baseSunday = new Date(Date.UTC(2026, 0, 4));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(baseSunday);
      date.setUTCDate(baseSunday.getUTCDate() + ((firstDayOfWeek + index) % 7));
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    });
  }, [firstDayOfWeek, locale]);
  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);

  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} type="button">
          {t("calendar.prev")}
        </Button>
        <p className="text-sm font-medium">
          {formatCompanyMonthYear(viewDate, locale)}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} type="button">
          {t("calendar.next")}
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {weekdayLabels.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-12" />;

          const isoDate = formatLocalDay(day);
          const isHoliday = holidaySet.has(isoDate);
          const dayState = dayStates[isoDate];
          const isSelected = isSameDay(day, selected);

          return (
            <button
              key={isoDate}
              className={cn(
                "flex h-12 items-center justify-center rounded-xl border text-sm tabular-nums transition-colors",
                dayState
                  ? entryStateUi[dayState].calendarCellClassName
                  : "border-transparent bg-background text-foreground hover:bg-muted",
                isSelected ? "border-2 border-foreground shadow-sm" : undefined,
                isHoliday ? "ring-1 ring-inset ring-amber-500/40 dark:ring-amber-400/40" : undefined,
              )}
              onClick={() => onSelect(day)}
              type="button"
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full font-medium",
                  dayState ? entryStateUi[dayState].calendarInnerClassName : undefined,
                  isHoliday && !dayState ? entryStateUi.holiday.calendarInnerClassName : undefined,
                  isSelected ? "font-bold" : undefined,
                )}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
