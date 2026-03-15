import { useEffect, useMemo, useRef, useState } from "react";
import { Input, inputBaseClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SegmentType = "day" | "month" | "year";

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { year: "", month: "", day: "" };
  }

  const [year, month, day] = value.split("-");
  return { year, month, day };
}

function getSegmentOrder(locale: string) {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const parts = formatter.formatToParts(new Date("2026-03-15T00:00:00"));
    const order = parts
      .filter((part) => part.type === "day" || part.type === "month" || part.type === "year")
      .map((part) => part.type as SegmentType);

    return order.length === 3 ? order : (["day", "month", "year"] as SegmentType[]);
  } catch {
    return ["day", "month", "year"] as SegmentType[];
  }
}

function clampSegment(type: SegmentType, value: string) {
  const numeric = value.replace(/\D/g, "");
  if (type === "year") {
    return numeric.slice(0, 4);
  }

  return numeric.slice(0, 2);
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

export function DateInput({
  value,
  locale,
  onChange,
  className,
}: {
  value: string;
  locale: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const dayRef = useRef<HTMLInputElement | null>(null);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);
  const initialSegments = useMemo(() => parseIsoDate(value), [value]);
  const [segments, setSegments] = useState(initialSegments);
  const [draftSegments, setDraftSegments] = useState(initialSegments);
  const order = useMemo(() => getSegmentOrder(locale), [locale]);

  useEffect(() => {
    setSegments(initialSegments);
    setDraftSegments(initialSegments);
  }, [initialSegments]);

  function updateSegment(type: SegmentType, nextValue: string) {
    const nextSegments = {
      ...draftSegments,
      [type]: clampSegment(type, nextValue),
    };
    setDraftSegments(nextSegments);

    if (isValidDate(nextSegments.year, nextSegments.month, nextSegments.day)) {
      setSegments(nextSegments);
      onChange(`${nextSegments.year}-${nextSegments.month}-${nextSegments.day}`);
    }
  }

  function handleFocus(type: SegmentType) {
    setDraftSegments((current) => ({
      ...current,
      [type]: "",
    }));
  }

  function handleBlur() {
    if (!isValidDate(draftSegments.year, draftSegments.month, draftSegments.day)) {
      setDraftSegments(segments);
    }
  }

  const placeholders: Record<SegmentType, string> = {
    day: "DD",
    month: "MM",
    year: "YYYY",
  };
  const refsByType = {
    day: dayRef,
    month: monthRef,
    year: yearRef,
  } as const;

  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2", className)}>
      {order.map((type, index) => (
        <div key={type} className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1"
            onClick={() => refsByType[type].current?.focus()}
          >
            <Input
              ref={refsByType[type]}
              className={cn(
                inputBaseClassName,
                "h-auto w-full border-0 bg-transparent p-0 text-center shadow-none focus-visible:ring-0",
              )}
              inputMode="numeric"
              placeholder={placeholders[type]}
              value={draftSegments[type]}
              onChange={(event) => updateSegment(type, event.target.value)}
              onFocus={() => handleFocus(type)}
              onBlur={handleBlur}
            />
          </button>
          {index < order.length - 1 ? <span className="text-muted-foreground">/</span> : null}
        </div>
      ))}
    </div>
  );
}
