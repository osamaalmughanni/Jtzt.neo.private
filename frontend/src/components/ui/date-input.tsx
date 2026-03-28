import { CalendarBlank } from "phosphor-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocalDay, getLocalNowSnapshot } from "@shared/utils/time";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input, inputBaseClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DateParts = { year: string; month: string; day: string };
type SegmentType = "day" | "month" | "year";
type PopupPosition = { top: number; left: number; width: number; maxHeight: number };

function parseIsoDate(value: string): DateParts {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { year: "", month: "", day: "" };
  }

  const [year, month, day] = value.split("-");
  return { year, month, day };
}

function getDateFormat(locale: string) {
  try {
    const parts = new Intl.DateTimeFormat(locale || "en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date("2026-03-15T00:00:00"));
    const filtered = parts.filter((part) => part.type === "day" || part.type === "month" || part.type === "year" || part.type === "literal");
    const order = filtered.filter((part) => part.type !== "literal").map((part) => part.type as SegmentType);
    const separator = filtered.find((part) => part.type === "literal")?.value.trim() || "/";
    return {
      order: order.length === 3 ? order : (["day", "month", "year"] as SegmentType[]),
      separator,
    };
  } catch {
    return {
      order: ["day", "month", "year"] as SegmentType[],
      separator: "/",
    };
  }
}

function buildPlaceholder(order: SegmentType[], separator: string) {
  const tokens: Record<SegmentType, string> = {
    day: "DD",
    month: "MM",
    year: "YYYY",
  };
  return order.map((part) => tokens[part]).join(separator);
}

function formatDisplayValue(value: string, order: SegmentType[], separator: string) {
  const parts = parseIsoDate(value);
  if (!parts.year || !parts.month || !parts.day) {
    return "";
  }

  return order.map((part) => parts[part]).join(separator);
}

function parseIsoDateToDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(year, month - 1, day);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() + 1 !== month ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

function isValidDate(year: string, month: string, day: string) {
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) return false;
  const candidate = new Date(Number(year), Number(month) - 1, Number(day));
  return (
    !Number.isNaN(candidate.getTime()) &&
    candidate.getFullYear() === Number(year) &&
    candidate.getMonth() + 1 === Number(month) &&
    candidate.getDate() === Number(day)
  );
}

function parseDateInput(rawValue: string, order: SegmentType[]): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parseIsoDate(trimmed);
    return isValidDate(parsed.year, parsed.month, parsed.day) ? trimmed : null;
  }

  const parts = trimmed.split(/[./\-\s]+/).filter(Boolean);
  if (parts.length !== 3) {
    return null;
  }

  const next: DateParts = { year: "", month: "", day: "" };
  for (let index = 0; index < order.length; index += 1) {
    const type = order[index];
    const maxLength = type === "year" ? 4 : 2;
    next[type] = parts[index].replace(/\D/g, "").slice(0, maxLength).padStart(maxLength, "0");
  }

  return isValidDate(next.year, next.month, next.day) ? `${next.year}-${next.month}-${next.day}` : null;
}

function resolveYear(value: string, fallbackYear: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return fallbackYear;
  if (digits.length === 2) {
    const prefix = fallbackYear.slice(0, 2);
    return `${prefix}${digits}`;
  }
  return digits.slice(0, 4).padStart(4, "0");
}

function parseSmartDateInput(rawValue: string, order: SegmentType[], fallbackIso: string) {
  const direct = parseDateInput(rawValue, order);
  if (direct !== null) {
    return direct;
  }

  const base = parseIsoDate(fallbackIso || formatLocalDay(new Date()));
  const tokens = rawValue.trim().split(/[./\-\s]+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }

  const next: DateParts = {
    year: base.year || String(new Date().getFullYear()),
    month: base.month || "01",
    day: base.day || "01",
  };

  if (tokens.length <= 2) {
    for (let index = 0; index < tokens.length; index += 1) {
      const type = order[index];
      const digits = tokens[index].replace(/\D/g, "");
      if (!digits) continue;
      if (type === "year") {
        next.year = resolveYear(digits, next.year);
      } else {
        next[type] = digits.slice(0, 2).padStart(2, "0");
      }
    }
    return isValidDate(next.year, next.month, next.day) ? `${next.year}-${next.month}-${next.day}` : null;
  }

  const digitsOnly = rawValue.replace(/\D/g, "");
  if (digitsOnly.length === 4) {
    next[order[0]] = digitsOnly.slice(0, 2).padStart(2, "0");
    next[order[1]] = digitsOnly.slice(2, 4).padStart(2, "0");
    return isValidDate(next.year, next.month, next.day) ? `${next.year}-${next.month}-${next.day}` : null;
  }

  return null;
}

export const DateInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    locale: string;
    onChange: (value: string) => void;
    todayDisabled?: boolean;
    showHelperButton?: boolean;
    timeZone?: string;
    firstDayOfWeek?: number;
    weekendDays?: number[];
    className?: string;
  }
>(({ value, locale, onChange, todayDisabled, showHelperButton = true, timeZone, firstDayOfWeek = 1, weekendDays = [6, 7], className }, forwardedRef) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const selectedDate = useMemo(() => parseIsoDateToDate(value), [value]);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const todayIso = getLocalNowSnapshot(new Date(), timeZone).localDay;
    return selectedDate ?? parseIsoDateToDate(todayIso) ?? new Date();
  });
  const { order, separator } = useMemo(() => getDateFormat(locale), [locale]);
  const placeholder = useMemo(() => buildPlaceholder(order, separator), [order, separator]);
  const [draft, setDraft] = useState(() => formatDisplayValue(value, order, separator));

  useImperativeHandle(forwardedRef, () => inputRef.current!, []);

  useEffect(() => {
    if (!focused) {
      setDraft(formatDisplayValue(value, order, separator));
    }
  }, [focused, order, separator, value]);

  useEffect(() => {
    if (!calendarOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const wrapper = wrapperRef.current;
      const popup = popupRef.current;
      if (wrapper?.contains(target) || popup?.contains(target)) {
        return;
      }

      setCalendarOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCalendarOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (calendarOpen) {
      const todayIso = getLocalNowSnapshot(new Date(), timeZone).localDay;
      setViewMonth(selectedDate ?? parseIsoDateToDate(todayIso) ?? new Date());
    }
  }, [calendarOpen, selectedDate, timeZone]);

  useEffect(() => {
    if (!calendarOpen) {
      setPopupPosition(null);
      return;
    }

    const updatePopupPosition = () => {
      const wrapper = wrapperRef.current;
      const popup = popupRef.current;
      if (!wrapper || !popup) {
        return;
      }

      const padding = 8;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const wrapperRect = wrapper.getBoundingClientRect();
      const popupWidth = Math.min(21 * 16, Math.max(12 * 16, viewportWidth - padding * 2));
      const popupHeight = Math.min(30 * 16, Math.max(16 * 16, viewportHeight - padding * 2));
      const spaceBelow = viewportHeight - wrapperRect.bottom - gap - padding;
      const spaceAbove = wrapperRect.top - gap - padding;
      const openDownward = spaceBelow >= Math.min(popupHeight, 18 * 16) || spaceBelow >= spaceAbove;
      const top = openDownward
        ? Math.min(viewportHeight - padding - popupHeight, wrapperRect.bottom + gap)
        : Math.max(padding, wrapperRect.top - gap - popupHeight);
      const preferredLeft = wrapperRect.right - popupWidth;
      const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - padding - popupWidth));
      const maxHeight = Math.max(12 * 16, Math.min(popupHeight, openDownward ? spaceBelow : spaceAbove));

      setPopupPosition({
        top,
        left,
        width: popupWidth,
        maxHeight,
      });
    };

    updatePopupPosition();

    let frame = 0;
    let rafId = 0;
    const bootstrap = () => {
      updatePopupPosition();
      frame += 1;
      if (frame < 4) {
        rafId = window.requestAnimationFrame(bootstrap);
      }
    };
    rafId = window.requestAnimationFrame(bootstrap);

    const handleViewportChange = () => updatePopupPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [calendarOpen]);

  function commit(rawValue: string) {
    const nextValue = parseSmartDateInput(rawValue, order, value || getLocalNowSnapshot(new Date(), timeZone).localDay);
    if (nextValue === null) {
      setDraft(formatDisplayValue(value, order, separator));
      return;
    }

    onChange(nextValue);
    setDraft(nextValue ? formatDisplayValue(nextValue, order, separator) : "");
  }

  function pickDate(date: Date) {
    const nextValue = formatLocalDay(date);
    onChange(nextValue);
    setDraft(formatDisplayValue(nextValue, order, separator));
    setCalendarOpen(false);
    setFocused(false);
  }

  return (
    <div ref={wrapperRef} className={cn("relative flex w-full min-w-0 items-center gap-2", className)}>
      <Input
        ref={inputRef}
        inputMode="numeric"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={(event) => {
          setFocused(false);
          commit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          inputBaseClassName,
          "min-w-0 flex-1 text-sm",
        )}
      />
      {showHelperButton ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("calendar.openDatePicker")}
          aria-haspopup="dialog"
          aria-expanded={calendarOpen}
          disabled={todayDisabled}
          onClick={() => setCalendarOpen((current) => !current)}
        >
          <CalendarBlank size={16} weight="regular" />
        </Button>
      ) : null}
      {calendarOpen ? (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t("calendar.selectDate")}
          className="fixed z-50 overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
          style={
            popupPosition
              ? {
                  top: `${popupPosition.top}px`,
                  left: `${popupPosition.left}px`,
                  width: `${popupPosition.width}px`,
                  maxHeight: `${popupPosition.maxHeight}px`,
                }
              : undefined
          }
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="overflow-auto p-2 sm:p-3" style={popupPosition ? { maxHeight: `${popupPosition.maxHeight}px` } : undefined}>
            <Calendar
              selected={selectedDate}
              month={viewMonth}
              locale={locale}
              firstDayOfWeek={firstDayOfWeek}
              weekendDays={weekendDays}
              compact
              bare
              onMonthChange={setViewMonth}
              onSelect={pickDate}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});

DateInput.displayName = "DateInput";
