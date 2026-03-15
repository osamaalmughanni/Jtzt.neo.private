import { Clock } from "phosphor-react";
import type { ChangeEvent, ComponentPropsWithoutRef, FocusEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function getCurrentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

interface TimeInputProps extends Omit<ComponentPropsWithoutRef<typeof Input>, "type"> {
  onNowClick?: (value: string) => void;
  nowDisabled?: boolean;
  wrapperClassName?: string;
}

function sanitizeTimeValue(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function normalizeTimeValue(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 3) return value;

  const rawHours = Number(digits.slice(0, 2));
  const rawMinutes = Number(digits.slice(2, 4).padEnd(2, "0"));
  const hours = String(Math.min(rawHours, 23)).padStart(2, "0");
  const minutes = String(Math.min(rawMinutes, 59)).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function TimeInput({
  className,
  onChange,
  onBlur,
  onNowClick,
  nowDisabled,
  wrapperClassName,
  ...props
}: TimeInputProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = sanitizeTimeValue(event.target.value);
    event.target.value = nextValue;
    onChange?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const nextValue = normalizeTimeValue(event.target.value);
    event.target.value = nextValue;
    onBlur?.(event);
  }

  return (
    <div className={cn("flex items-center gap-2", wrapperClassName)}>
      <Input
        className={cn("flex-1", className)}
        inputMode="numeric"
        placeholder="08:00"
        {...props}
        onBlur={handleBlur}
        onChange={handleChange}
      />
      <Button
        variant="outline"
        size="icon"
        type="button"
        aria-label="Use current time"
        disabled={nowDisabled}
        onClick={() => onNowClick?.(getCurrentTimeValue())}
      >
        <Clock size={18} weight="bold" />
      </Button>
    </div>
  );
}
