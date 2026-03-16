import { CalendarPlus } from "phosphor-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatLocalDay } from "@shared/utils/time";
import { Button } from "@/components/ui/button";
import { Input, inputBaseClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DateParts = { year: string; month: string; day: string };
type SegmentType = "day" | "month" | "year";

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
    className?: string;
  }
>(({ value, locale, onChange, todayDisabled, className }, forwardedRef) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const { order, separator } = useMemo(() => getDateFormat(locale), [locale]);
  const placeholder = useMemo(() => buildPlaceholder(order, separator), [order, separator]);
  const [draft, setDraft] = useState(() => formatDisplayValue(value, order, separator));

  useImperativeHandle(forwardedRef, () => inputRef.current!, []);

  useEffect(() => {
    if (!focused) {
      setDraft(formatDisplayValue(value, order, separator));
    }
  }, [focused, order, separator, value]);

  function commit(rawValue: string) {
    const nextValue = parseSmartDateInput(rawValue, order, value || formatLocalDay(new Date()));
    if (nextValue === null) {
      setDraft(formatDisplayValue(value, order, separator));
      return;
    }

    onChange(nextValue);
    setDraft(nextValue ? formatDisplayValue(nextValue, order, separator) : "");
  }

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
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
          "min-w-0 flex-1 text-[clamp(0.9rem,1.4vw,1rem)]",
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full text-muted-foreground"
        aria-label="Use today"
        disabled={todayDisabled}
        onClick={() => {
          const todayValue = formatLocalDay(new Date());
          onChange(todayValue);
          setDraft(formatDisplayValue(todayValue, order, separator));
        }}
      >
        <CalendarPlus size={16} weight="regular" />
      </Button>
    </div>
  );
});

DateInput.displayName = "DateInput";
