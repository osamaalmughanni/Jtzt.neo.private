import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { TimeEntryType } from "@shared/types/models";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { cn } from "@/lib/utils";

interface LeaveBarProps {
  label: string;
  value: string;
  used: number;
  limit: number;
  trackClassName: string;
  fillClassName: string;
  overflowClassName?: string;
}

function LeaveBar({ label, value, used, limit, trackClassName, fillClassName, overflowClassName }: LeaveBarProps) {
  const safeUsed = Math.max(0, used);
  const safeLimit = Math.max(0, limit);
  const scale = Math.max(safeUsed, safeLimit, 1);
  const fillRatio = Math.min(safeUsed, safeLimit) / scale;
  const overflowRatio = safeUsed > safeLimit ? (safeUsed - safeLimit) / scale : 0;
  const hasOverflow = overflowRatio > 0;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-medium text-foreground">{label}</p>
        <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{value}</p>
      </div>
      <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full", trackClassName)}>
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-full will-change-[width]", fillClassName)}
          initial={false}
          animate={{ width: `${fillRatio * 100}%` }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        />
        {hasOverflow ? (
          <motion.div
            className={cn("absolute inset-y-0 rounded-full will-change-[width,left]", overflowClassName)}
            initial={false}
            animate={{
              left: `${fillRatio * 100}%`,
              width: `${overflowRatio * 100}%`,
            }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          />
        ) : null}
      </div>
    </div>
  );
}

function formatNumber(locale: string, value: number) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatHours(locale: string, value: number) {
  return `${formatNumber(locale, value)}h`;
}

interface LeaveStateBarsProps {
  locale: string;
  entryType: TimeEntryType;
  vacation: {
    entitledDays: number;
    usedDays: number;
    availableDays: number;
  };
  timeOffInLieu: {
    earnedMinutes: number;
    bookedMinutes: number;
    availableMinutes: number;
  };
  sickLeave: {
    usedDays: number;
    elapsedDays: number;
  };
}

export function LeaveStateBars({ locale, entryType, vacation, timeOffInLieu, sickLeave }: LeaveStateBarsProps) {
  const { t } = useTranslation();
  const entryStateUi = getEntryStateUi(t);
  const ui = entryStateUi[entryType];

  const content = useMemo(() => {
    if (entryType === "vacation") {
      return {
        label: t("recordEditor.vacation"),
        value: `${formatNumber(locale, vacation.usedDays)} / ${formatNumber(locale, vacation.entitledDays)} ${t("recordEditor.days")}`,
        used: vacation.usedDays,
        limit: vacation.entitledDays,
      };
    }

    if (entryType === "time_off_in_lieu") {
      return {
        label: t("recordEditor.timeOffInLieu"),
        value: `${formatHours(locale, timeOffInLieu.bookedMinutes / 60)} / ${formatHours(locale, timeOffInLieu.earnedMinutes / 60)}`,
        used: timeOffInLieu.bookedMinutes,
        limit: timeOffInLieu.earnedMinutes,
      };
    }

    if (entryType === "sick_leave") {
      return {
        label: t("recordEditor.sickLeave"),
        value: `${formatNumber(locale, sickLeave.usedDays)} ${t("recordEditor.days")}`,
        used: sickLeave.usedDays,
        limit: sickLeave.elapsedDays,
      };
    }

    return null;
  }, [entryType, locale, sickLeave.elapsedDays, sickLeave.usedDays, t, timeOffInLieu.bookedMinutes, timeOffInLieu.earnedMinutes, vacation.entitledDays, vacation.usedDays]);

  if (!content) {
    return null;
  }

  return (
    <LeaveBar
      label={content.label}
      value={content.value}
      used={content.used}
      limit={content.limit}
      trackClassName={ui.barTrackClassName ?? "bg-muted"}
      fillClassName={ui.barFillClassName ?? "bg-foreground"}
      overflowClassName={ui.barOverflowClassName}
    />
  );
}
