import { Clock } from "phosphor-react";
import { useEffect, useRef, useState } from "react";
import { toClockTimeValue } from "@shared/utils/time";
import { Button } from "@/components/ui/button";
import { Input, inputBaseClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function getCurrentTimeValue(timeZone?: string) {
  return toClockTimeValue(new Date().toISOString(), timeZone);
}

function isValidTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function normalizeTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const direct = trimmed.replace(/[.h\s]+/g, ":");
  const parts = direct.split(":").filter(Boolean);
  if (parts.length === 2) {
    const hours = parts[0].replace(/\D/g, "").slice(0, 2).padStart(2, "0");
    const minutes = parts[1].replace(/\D/g, "").slice(0, 2).padStart(2, "0");
    const normalized = `${hours}:${minutes}`;
    return isValidTime(normalized) ? normalized : null;
  }

  if (parts.length === 1) {
    const digits = parts[0].replace(/\D/g, "").slice(0, 4);
    if (!digits) return "";

    if (digits.length <= 2) {
      const normalized = `${digits.padStart(2, "0")}:00`;
      return isValidTime(normalized) ? normalized : null;
    }

    if (digits.length === 3) {
      const normalized = `${digits.slice(0, 1).padStart(2, "0")}:${digits.slice(1, 3)}`;
      return isValidTime(normalized) ? normalized : null;
    }

    const normalized = `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    return isValidTime(normalized) ? normalized : null;
  }

  return null;
}

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  onNowClick?: (value: string) => void;
  nowDisabled?: boolean;
  showHelperButton?: boolean;
  timeZone?: string;
  locale?: string;
  className?: string;
}

export function TimeInput({ value, onChange, onNowClick, nowDisabled, showHelperButton = true, timeZone, className }: TimeInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [focused, value]);

  function commit(rawValue: string) {
    const normalized = normalizeTime(rawValue);
    if (normalized === null) {
      setDraft(value);
      return;
    }

    onChange(normalized);
    setDraft(normalized);
  }

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <Input
        ref={inputRef}
        inputMode="numeric"
        placeholder="HH:MM"
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
          className="h-10 w-10 shrink-0 text-muted-foreground"
          aria-label="Use current time"
          disabled={nowDisabled}
          onClick={() => {
            const nowValue = getCurrentTimeValue(timeZone);
            onChange(nowValue);
            onNowClick?.(nowValue);
            setDraft(nowValue);
          }}
        >
          <Clock size={16} weight="regular" />
        </Button>
      ) : null}
    </div>
  );
}
