import { Clock } from "phosphor-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toClockTimeValue } from "@shared/utils/time";
import { Button } from "@/components/ui/button";
import { Input, inputBaseClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function getCurrentTimeValue(timeZone?: string) {
  return toClockTimeValue(new Date().toISOString(), timeZone);
}

function parseTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return { hours: "", minutes: "" };
  }

  const [hours, minutes] = value.split(":");
  return { hours, minutes };
}

function clampSegment(type: "hours" | "minutes", value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  if (digits.length === 0) {
    return "";
  }

  if (digits.length === 1) {
    return digits;
  }

  const limit = type === "hours" ? 23 : 59;
  return String(Math.min(Number(digits), limit)).padStart(2, "0");
}

function isValidTime(hours: string, minutes: string) {
  if (hours.length !== 2 || minutes.length !== 2) {
    return false;
  }

  const hourValue = Number(hours);
  const minuteValue = Number(minutes);
  return hourValue >= 0 && hourValue <= 23 && minuteValue >= 0 && minuteValue <= 59;
}

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  onNowClick?: (value: string) => void;
  nowDisabled?: boolean;
  timeZone?: string;
  className?: string;
}

export function TimeInput({
  value,
  onChange,
  onNowClick,
  nowDisabled,
  timeZone,
  className,
}: TimeInputProps) {
  const hoursRef = useRef<HTMLInputElement | null>(null);
  const minutesRef = useRef<HTMLInputElement | null>(null);
  const initialSegments = useMemo(() => parseTime(value), [value]);
  const [segments, setSegments] = useState(initialSegments);
  const [draftSegments, setDraftSegments] = useState(initialSegments);

  useEffect(() => {
    setSegments(initialSegments);
    setDraftSegments(initialSegments);
  }, [initialSegments]);

  function updateSegment(type: "hours" | "minutes", nextValue: string) {
    const nextSegments = {
      ...draftSegments,
      [type]: clampSegment(type, nextValue),
    };
    setDraftSegments(nextSegments);

    if (isValidTime(nextSegments.hours, nextSegments.minutes)) {
      setSegments(nextSegments);
      onChange(`${nextSegments.hours}:${nextSegments.minutes}`);
    }
  }

  function handleFocus(type: "hours" | "minutes") {
    setDraftSegments((current) => ({
      ...current,
      [type]: "",
    }));
  }

  function handleBlur() {
    if (!isValidTime(draftSegments.hours, draftSegments.minutes)) {
      setDraftSegments(segments);
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1"
          onClick={() => hoursRef.current?.focus()}
        >
          <Input
            ref={hoursRef}
            className={cn(inputBaseClassName, "h-auto w-full border-0 bg-transparent p-0 text-center shadow-none focus-visible:ring-0")}
            inputMode="numeric"
            placeholder="HH"
            value={draftSegments.hours}
            onChange={(event) => updateSegment("hours", event.target.value)}
            onFocus={() => handleFocus("hours")}
            onBlur={handleBlur}
          />
        </button>
        <span className="text-muted-foreground">:</span>
        <button
          type="button"
          className="flex min-w-0 flex-1"
          onClick={() => minutesRef.current?.focus()}
        >
          <Input
            ref={minutesRef}
            className={cn(inputBaseClassName, "h-auto w-full border-0 bg-transparent p-0 text-center shadow-none focus-visible:ring-0")}
            inputMode="numeric"
            placeholder="MM"
            value={draftSegments.minutes}
            onChange={(event) => updateSegment("minutes", event.target.value)}
            onFocus={() => handleFocus("minutes")}
            onBlur={handleBlur}
          />
        </button>
      </div>
      <Button
        variant="outline"
        size="icon"
        type="button"
        aria-label="Use current time"
        disabled={nowDisabled}
        onClick={() => {
          const nowValue = getCurrentTimeValue(timeZone);
          const nextSegments = parseTime(nowValue);
          setSegments(nextSegments);
          setDraftSegments(nextSegments);
          onChange(nowValue);
          onNowClick?.(nowValue);
        }}
      >
        <Clock size={18} weight="bold" />
      </Button>
    </div>
  );
}
