import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocalDay } from "@shared/utils/time";
import { CaretLeft, CaretRight } from "phosphor-react";
import { Button } from "@/components/ui/button";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { formatCompanyMonthYear } from "@/lib/locale-format";
import { cn } from "@/lib/utils";
import { isWeekendDay } from "@shared/utils/time";

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

type CalendarDayState = "work" | "sick_leave" | "vacation" | "time_off_in_lieu" | "mixed";

export interface CalendarProps {
  selected?: Date | null;
  month?: Date;
  onSelect: (date: Date) => void;
  firstDayOfWeek?: number;
  className?: string;
  locale?: string;
  holidayDates?: string[];
  dayStates?: Record<string, CalendarDayState>;
  onMonthChange?: (date: Date) => void;
  compact?: boolean;
  disableDate?: (date: Date) => boolean;
  bare?: boolean;
  weekendDays?: number[];
  selectionTone?: "default" | "destructive";
}

function CalendarBase({
  selected,
  month,
  onSelect,
  firstDayOfWeek = 1,
  className,
  locale = "en-GB",
  holidayDates = [],
  dayStates = {},
  onMonthChange,
  compact = false,
  disableDate,
  bare = false,
  weekendDays = [6, 7],
  selectionTone = "default",
}: CalendarProps) {
  const { t, i18n } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const initialViewDate = startOfMonth(selected ?? month ?? new Date());
  const [uncontrolledViewDate, setUncontrolledViewDate] = useState(initialViewDate);
  const normalizedFirstDayOfWeek = ((Math.trunc(firstDayOfWeek) % 7) + 7) % 7;
  const displayLocale = (i18n.resolvedLanguage?.trim() || locale || "en-GB").trim();
  const viewDate = startOfMonth(month ?? uncontrolledViewDate);

  useEffect(() => {
    if (month) return;

    const next = startOfMonth(selected ?? new Date());
    setUncontrolledViewDate((current) =>
      current.getFullYear() === next.getFullYear() && current.getMonth() === next.getMonth() ? current : next,
    );
  }, [month, selected]);

  function updateViewDate(nextDate: Date) {
    const normalized = startOfMonth(nextDate);
    if (!month) {
      setUncontrolledViewDate(normalized);
    }
    onMonthChange?.(normalized);
  }

  const monthCells = useMemo(() => {
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);
    const leading = (first.getDay() - normalizedFirstDayOfWeek + 7) % 7;
    const result: Array<Array<Date | null>> = [];
    let slot = 0;
    let week: Array<Date | null> = Array.from({ length: 7 }, () => null);

    for (let index = 0; index < leading; index += 1) {
      week[index] = null;
      slot += 1;
    }

    for (let day = 1; day <= last.getDate(); day += 1) {
      if (slot >= 7) {
        result.push(week);
        week = Array.from({ length: 7 }, () => null);
        slot = 0;
      }

      week[slot] = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      slot += 1;
    }

    if (week.some((day) => day !== null) || result.length === 0) {
      result.push(week);
    }

    return result;
  }, [normalizedFirstDayOfWeek, viewDate]);

  const weekdayLabels = useMemo(() => {
    const baseSunday = new Date(Date.UTC(2026, 0, 4));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(baseSunday);
      date.setUTCDate(baseSunday.getUTCDate() + ((normalizedFirstDayOfWeek + index) % 7));
      const isoDay = ((date.getUTCDay() + 6) % 7) + 1;
      return {
        label: new Intl.DateTimeFormat(displayLocale, { weekday: "short", timeZone: "UTC" }).format(date),
        isWeekend: weekendDays.includes(isoDay),
      };
    });
  }, [displayLocale, normalizedFirstDayOfWeek, weekendDays]);

  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);
  const wrapperClassName = compact ? "gap-2 p-2" : "gap-4 p-4";
  const weekdayClassName = compact ? "text-[10px]" : "text-xs";
  const headerTextClassName = compact ? "text-[11px] font-medium" : "text-sm font-medium";
  const navButtonClassName = compact ? "h-7 w-7 p-0" : "h-9 w-9 p-0";
  const dayGridClassName = "flex flex-col gap-1";
  const weekRowClassName = "grid grid-cols-7 gap-1";
  const cellClassName = compact ? "text-[11px]" : "text-sm";
  const dayCellHeightClassName = compact ? "min-h-8" : "min-h-10 sm:min-h-11";
  const innerClassName = compact ? "h-5 w-5 text-[11px]" : "h-7 w-7 sm:h-8 sm:w-8";
  const selectionRingClassName =
    selectionTone === "destructive"
      ? "border-destructive ring-1 ring-inset ring-destructive/55"
      : "border-foreground ring-1 ring-inset ring-foreground/45";
  const stateInsetClassName = compact ? "inset-0.5" : "inset-1";
  const stateTextClassName = compact ? "text-[11px]" : "text-sm";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden",
        bare ? "rounded-none border-0 bg-transparent" : "rounded-2xl border border-border bg-card",
        wrapperClassName,
        className,
      )}
    >
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className={navButtonClassName}
          onClick={() => updateViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
          type="button"
          aria-label={t("calendar.prev")}
        >
          {compact ? <CaretLeft size={14} weight="bold" /> : t("calendar.prev")}
        </Button>
        <p className={cn(headerTextClassName, "min-w-0 truncate text-center")}>
          {formatCompanyMonthYear(viewDate, displayLocale)}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className={navButtonClassName}
          onClick={() => updateViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
          type="button"
          aria-label={t("calendar.next")}
        >
          {compact ? <CaretRight size={14} weight="bold" /> : t("calendar.next")}
        </Button>
      </div>

      <div className={cn("grid grid-cols-7 gap-1 text-center text-muted-foreground", weekdayClassName)}>
        {weekdayLabels.map((day) => (
          <div key={day.label} className={cn(day.isWeekend ? "text-foreground/80" : undefined)}>
            {day.label}
          </div>
        ))}
      </div>

      <div className={dayGridClassName}>
        {monthCells.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} className={weekRowClassName}>
            {week.map((day, dayIndex) => {
              const slotKey = `slot-${weekIndex}-${dayIndex}`;

              if (!day) {
                return <div key={slotKey} aria-hidden="true" className={cn("w-full", dayCellHeightClassName)} />;
              }

              const isoDate = formatLocalDay(day);
              const isHoliday = holidaySet.has(isoDate);
              const dayState = dayStates[isoDate];
              const isSelected = selected ? isSameDay(day, selected) : false;
              const isDisabled = disableDate?.(day) ?? false;
              const weekend = isWeekendDay(isoDate, weekendDays);

              const baseCellClassName = cn(
                "relative flex w-full items-center justify-center overflow-hidden rounded-lg border tabular-nums transition-[background-color,border-color,color,opacity] duration-200 ease-out",
                dayCellHeightClassName,
                cellClassName,
                isDisabled
                  ? "cursor-not-allowed border-transparent bg-background text-muted-foreground/40 opacity-50"
                  : undefined,
                dayState
                  ? entryStateUi[dayState].calendarCellClassName
                  : isHoliday
                    ? entryStateUi.holiday.calendarCellClassName
                    : weekend
                      ? "border-border/80 bg-muted/35 text-foreground hover:bg-muted/50"
                      : "border-border/80 bg-background text-foreground hover:bg-muted/40",
                isSelected ? selectionRingClassName : undefined,
              );

              const innerStateClassName =
                dayState
                  ? entryStateUi[dayState].calendarInnerClassName
                  : isHoliday
                    ? entryStateUi.holiday.calendarInnerClassName
                    : weekend
                      ? "bg-muted/55 ring-1 ring-inset ring-border/70"
                      : "bg-background";

              return (
                <button
                  key={slotKey}
                  className={baseCellClassName}
                  onClick={() => {
                    if (!isDisabled) {
                      onSelect(day);
                    }
                  }}
                  type="button"
                  disabled={isDisabled}
                  aria-disabled={isDisabled}
                >
                  {dayState || isHoliday ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute rounded-full transition-[background-color,border-color,opacity] duration-200 ease-out",
                        stateInsetClassName,
                        innerStateClassName,
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 flex items-center justify-center rounded-full font-medium transition-[color,opacity] duration-200 ease-out",
                      innerClassName,
                      stateTextClassName,
                      weekend && !dayState && !isHoliday ? "opacity-90" : undefined,
                      isSelected ? "font-semibold" : undefined,
                    )}
                  >
                    {day.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function areCalendarPropsEqual(prev: CalendarProps, next: CalendarProps) {
  return (
    prev.selected?.getTime() === next.selected?.getTime() &&
    prev.month?.getTime() === next.month?.getTime() &&
    prev.firstDayOfWeek === next.firstDayOfWeek &&
    prev.className === next.className &&
    prev.locale === next.locale &&
    prev.holidayDates === next.holidayDates &&
    prev.dayStates === next.dayStates &&
    prev.compact === next.compact &&
    prev.disableDate === next.disableDate &&
    prev.bare === next.bare &&
    prev.weekendDays === next.weekendDays &&
    prev.selectionTone === next.selectionTone
  );
}

export const Calendar = memo(CalendarBase, areCalendarPropsEqual);
