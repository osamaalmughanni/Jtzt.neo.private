import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocalDay } from "@shared/utils/time";
import { CaretLeft, CaretRight } from "phosphor-react";
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
  onMonthChange,
  compact = false,
  disableDate,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  firstDayOfWeek?: number;
  className?: string;
  locale?: string;
  holidayDates?: string[];
  dayStates?: Record<string, "work" | "sick_leave" | "vacation" | "mixed">;
  onMonthChange?: (date: Date) => void;
  compact?: boolean;
  disableDate?: (date: Date) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const [viewDate, setViewDate] = useState(startOfMonth(selected));
  const selectedMonthKey = `${selected.getFullYear()}-${selected.getMonth()}`;
  const normalizedFirstDayOfWeek = ((Math.trunc(firstDayOfWeek) % 7) + 7) % 7;
  const displayLocale = (i18n.resolvedLanguage?.trim() || locale || "en-GB").trim();

  useEffect(() => {
    setViewDate(startOfMonth(selected));
  }, [selectedMonthKey]);

  useEffect(() => {
    onMonthChange?.(viewDate);
  }, [onMonthChange, viewDate]);

  const days = useMemo(() => {
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);
    const leading = (first.getDay() - normalizedFirstDayOfWeek + 7) % 7;
    const result: Array<Date | null> = [];

    for (let index = 0; index < leading; index += 1) result.push(null);
    for (let day = 1; day <= last.getDate(); day += 1) {
      result.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [normalizedFirstDayOfWeek, viewDate]);

  const weekdayLabels = useMemo(() => {
    const baseSunday = new Date(Date.UTC(2026, 0, 4));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(baseSunday);
      date.setUTCDate(baseSunday.getUTCDate() + ((normalizedFirstDayOfWeek + index) % 7));
      return new Intl.DateTimeFormat(displayLocale, { weekday: "short", timeZone: "UTC" }).format(date);
    });
  }, [displayLocale, normalizedFirstDayOfWeek]);
  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);
  const cellClassName = compact ? "h-7 text-[11px]" : "h-12 text-sm";
  const emptyCellClassName = compact ? "h-7" : "h-12";
  const innerClassName = compact ? "h-5 w-5 text-[11px]" : "h-8 w-8";
  const wrapperClassName = compact ? "gap-2 p-2" : "gap-4 p-4";
  const weekdayClassName = compact ? "text-[10px]" : "text-xs";
  const headerTextClassName = compact ? "text-[11px] font-medium" : "text-sm font-medium";
  const navButtonClassName = compact ? "h-7 w-7 p-0" : "h-9 px-3";

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-card", wrapperClassName, className)}>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          className={navButtonClassName}
          onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
          type="button"
          aria-label={t("calendar.prev")}
        >
          {compact ? <CaretLeft size={14} weight="bold" /> : t("calendar.prev")}
        </Button>
        <p className={headerTextClassName}>
          {formatCompanyMonthYear(viewDate, displayLocale)}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className={navButtonClassName}
          onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
          type="button"
          aria-label={t("calendar.next")}
        >
          {compact ? <CaretRight size={14} weight="bold" /> : t("calendar.next")}
        </Button>
      </div>

      <div className={cn("grid grid-cols-7 gap-1 text-center text-muted-foreground", weekdayClassName)}>
        {weekdayLabels.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className={emptyCellClassName} />;

          const isoDate = formatLocalDay(day);
          const isHoliday = holidaySet.has(isoDate);
          const dayState = dayStates[isoDate];
          const isSelected = isSameDay(day, selected);
          const isDisabled = disableDate?.(day) ?? false;

          return (
            <button
              key={isoDate}
              className={cn(
                "flex items-center justify-center rounded-xl border tabular-nums transition-colors",
                cellClassName,
                isDisabled
                  ? "cursor-not-allowed border-transparent bg-background text-muted-foreground/40 opacity-50"
                  : undefined,
                dayState
                  ? entryStateUi[dayState].calendarCellClassName
                  : "border-transparent bg-background text-foreground hover:bg-muted",
                isSelected ? "border-2 border-foreground shadow-sm" : undefined,
                isHoliday ? "ring-1 ring-inset ring-amber-500/40 dark:ring-amber-400/40" : undefined,
              )}
              onClick={() => {
                if (!isDisabled) {
                  onSelect(day);
                }
              }}
              type="button"
              disabled={isDisabled}
              aria-disabled={isDisabled}
            >
              <span
                className={cn(
                  "flex items-center justify-center rounded-full font-medium",
                  innerClassName,
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
