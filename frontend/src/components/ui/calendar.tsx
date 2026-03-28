import { useEffect, useMemo, useState } from "react";
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

export function Calendar({
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
}: {
  selected?: Date | null;
  month?: Date;
  onSelect: (date: Date) => void;
  firstDayOfWeek?: number;
  className?: string;
  locale?: string;
  holidayDates?: string[];
  dayStates?: Record<string, "work" | "sick_leave" | "vacation" | "time_off_in_lieu" | "mixed">;
  onMonthChange?: (date: Date) => void;
  compact?: boolean;
  disableDate?: (date: Date) => boolean;
  bare?: boolean;
  weekendDays?: number[];
  selectionTone?: "default" | "destructive";
}) {
  const { t, i18n } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const initialViewDate = startOfMonth(selected ?? month ?? new Date());
  const [uncontrolledViewDate, setUncontrolledViewDate] = useState(initialViewDate);
  const normalizedFirstDayOfWeek = ((Math.trunc(firstDayOfWeek) % 7) + 7) % 7;
  const displayLocale = (i18n.resolvedLanguage?.trim() || locale || "en-GB").trim();
  const viewDate = startOfMonth(month ?? uncontrolledViewDate);

  useEffect(() => {
    if (!month) {
      setUncontrolledViewDate(startOfMonth(selected ?? new Date()));
    }
  }, [month, selected]);

  function updateViewDate(nextDate: Date) {
    const normalized = startOfMonth(nextDate);
    if (!month) {
      setUncontrolledViewDate(normalized);
    }
    onMonthChange?.(normalized);
  }

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
      const isoDay = ((date.getUTCDay() + 6) % 7) + 1;
      return {
        label: new Intl.DateTimeFormat(displayLocale, { weekday: "short", timeZone: "UTC" }).format(date),
        isWeekend: weekendDays.includes(isoDay),
      };
    });
  }, [displayLocale, normalizedFirstDayOfWeek, weekendDays]);
  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);
  const cellClassName = compact ? "h-7 text-[11px]" : "h-12 text-sm";
  const emptyCellClassName = compact ? "h-7" : "h-12";
  const innerClassName = compact ? "h-5 w-5 text-[11px]" : "h-8 w-8";
  const wrapperClassName = compact ? "gap-2 p-2" : "gap-4 p-4";
  const weekdayClassName = compact ? "text-[10px]" : "text-xs";
  const headerTextClassName = compact ? "text-[11px] font-medium" : "text-sm font-medium";
  const navButtonClassName = compact ? "h-7 w-7 p-0" : "h-9 px-3";
  const selectionRingClassName =
    selectionTone === "destructive"
      ? "border-destructive ring-1 ring-inset ring-destructive/55"
      : "border-foreground ring-1 ring-inset ring-foreground/45";
  const stateInsetClassName = compact ? "inset-0.5" : "inset-1";
  const stateTextClassName = compact ? "text-[11px]" : "text-sm";

  return (
    <div
      className={cn(
        "flex flex-col",
        bare ? "rounded-none border-0 bg-transparent" : "rounded-2xl border border-border bg-card",
        wrapperClassName,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
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
        <p className={headerTextClassName}>
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
          <div
            key={day.label}
            className={cn(day.isWeekend ? "text-foreground/80" : undefined)}
          >
            {day.label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className={emptyCellClassName} />;

          const isoDate = formatLocalDay(day);
          const isHoliday = holidaySet.has(isoDate);
          const dayState = dayStates[isoDate];
          const isSelected = selected ? isSameDay(day, selected) : false;
          const isDisabled = disableDate?.(day) ?? false;
          const weekend = isWeekendDay(isoDate, weekendDays);
          const baseCellClassName = cn(
            "relative flex items-center justify-center overflow-hidden rounded-xl border tabular-nums transition-[background-color,border-color,color,opacity] duration-200 ease-out",
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
              key={isoDate}
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
                    "pointer-events-none absolute",
                    stateInsetClassName,
                    "rounded-full transition-[background-color,border-color,transform,opacity] duration-200 ease-out",
                    innerStateClassName,
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 flex items-center justify-center rounded-full font-medium transition-[color,transform] duration-200 ease-out",
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
    </div>
  );
}
