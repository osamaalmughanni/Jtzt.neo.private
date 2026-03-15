import type { TFunction } from "i18next";
import type { TimeEntryType } from "@shared/types/models";

export type EntryStateUiMap = Record<
  TimeEntryType | "holiday" | "mixed",
  {
    label: string;
    badgeClassName: string;
    dotClassName: string;
    calendarCellClassName: string;
    calendarInnerClassName: string;
  }
>;

export function getEntryStateUi(t: TFunction): EntryStateUiMap {
  return {
    work: {
      label: t("recordEditor.working"),
      badgeClassName: "border-emerald-500/30 bg-emerald-500/15 text-foreground shadow-sm dark:border-emerald-400/30 dark:bg-emerald-400/15",
      dotClassName: "bg-emerald-500 ring-1 ring-emerald-500/40 dark:bg-emerald-400 dark:ring-emerald-400/40",
      calendarCellClassName: "border-emerald-500/30 bg-emerald-500/15 text-foreground dark:border-emerald-400/30 dark:bg-emerald-400/15",
      calendarInnerClassName: "bg-emerald-500/15 dark:bg-emerald-400/15",
    },
    vacation: {
      label: t("recordEditor.vacation"),
      badgeClassName: "border-sky-500/30 bg-sky-500/15 text-foreground shadow-sm dark:border-sky-400/30 dark:bg-sky-400/15",
      dotClassName: "bg-sky-500 ring-1 ring-sky-500/40 dark:bg-sky-400 dark:ring-sky-400/40",
      calendarCellClassName: "border-sky-500/30 bg-sky-500/15 text-foreground dark:border-sky-400/30 dark:bg-sky-400/15",
      calendarInnerClassName: "bg-sky-500/15 dark:bg-sky-400/15",
    },
    sick_leave: {
      label: t("recordEditor.sickLeave"),
      badgeClassName: "border-rose-500/30 bg-rose-500/15 text-foreground shadow-sm dark:border-rose-400/30 dark:bg-rose-400/15",
      dotClassName: "bg-rose-500 ring-1 ring-rose-500/40 dark:bg-rose-400 dark:ring-rose-400/40",
      calendarCellClassName: "border-rose-500/30 bg-rose-500/15 text-foreground dark:border-rose-400/30 dark:bg-rose-400/15",
      calendarInnerClassName: "bg-rose-500/15 dark:bg-rose-400/15",
    },
    holiday: {
      label: t("calendar.publicHoliday"),
      badgeClassName: "border-amber-500/30 bg-amber-500/10 text-foreground shadow-sm dark:border-amber-400/30 dark:bg-amber-400/10",
      dotClassName: "bg-amber-500 ring-1 ring-amber-500/40 dark:bg-amber-400 dark:ring-amber-400/40",
      calendarCellClassName: "",
      calendarInnerClassName: "bg-amber-500/10 dark:bg-amber-400/10",
    },
    mixed: {
      label: t("calendar.mixed"),
      badgeClassName: "border-violet-500/30 bg-violet-500/15 text-foreground shadow-sm dark:border-violet-400/30 dark:bg-violet-400/15",
      dotClassName: "bg-violet-500 ring-1 ring-violet-500/40 dark:bg-violet-400 dark:ring-violet-400/40",
      calendarCellClassName: "border-violet-500/30 bg-violet-500/15 text-foreground dark:border-violet-400/30 dark:bg-violet-400/15",
      calendarInnerClassName: "bg-violet-500/15 dark:bg-violet-400/15",
    },
  };
}

export function getEntryTypeLabel(entryType: TimeEntryType, t: TFunction) {
  return getEntryStateUi(t)[entryType].label;
}
