import type { TFunction } from "i18next";
import type { TimeEntryType } from "@shared/types/models";

export type EntryStateUiMap = Record<
  TimeEntryType | "holiday" | "mixed",
  {
    label: string;
    activeTriggerClassName: string;
    badgeClassName: string;
    dotClassName: string;
    calendarCellClassName: string;
    calendarInnerClassName: string;
    recordStatusClassName: string;
  }
>;

export function getEntryStateUi(t: TFunction): EntryStateUiMap {
  return {
    work: {
      label: t("recordEditor.working"),
      activeTriggerClassName: "data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-700 dark:data-[state=active]:border-emerald-400/30 dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-200",
      badgeClassName: "border-emerald-500/30 bg-emerald-500/15 text-foreground shadow-sm dark:border-emerald-400/30 dark:bg-emerald-400/15",
      dotClassName: "bg-emerald-500 ring-1 ring-emerald-500/40 dark:bg-emerald-400 dark:ring-emerald-400/40",
      calendarCellClassName: "border-emerald-500/30 bg-emerald-500/15 text-foreground dark:border-emerald-400/30 dark:bg-emerald-400/15",
      calendarInnerClassName: "bg-emerald-500/15 dark:bg-emerald-400/15",
      recordStatusClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    vacation: {
      label: t("recordEditor.vacation"),
      activeTriggerClassName: "data-[state=active]:border-sky-500/30 data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-700 dark:data-[state=active]:border-sky-400/30 dark:data-[state=active]:bg-sky-400/15 dark:data-[state=active]:text-sky-200",
      badgeClassName: "border-sky-500/30 bg-sky-500/15 text-foreground shadow-sm dark:border-sky-400/30 dark:bg-sky-400/15",
      dotClassName: "bg-sky-500 ring-1 ring-sky-500/40 dark:bg-sky-400 dark:ring-sky-400/40",
      calendarCellClassName: "border-sky-500/30 bg-sky-500/15 text-foreground dark:border-sky-400/30 dark:bg-sky-400/15",
      calendarInnerClassName: "bg-sky-500/15 dark:bg-sky-400/15",
      recordStatusClassName: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
    time_off_in_lieu: {
      label: t("recordEditor.timeOffInLieu"),
      activeTriggerClassName: "data-[state=active]:border-yellow-500/30 data-[state=active]:bg-yellow-500/15 data-[state=active]:text-yellow-700 dark:data-[state=active]:border-yellow-400/30 dark:data-[state=active]:bg-yellow-400/15 dark:data-[state=active]:text-yellow-200",
      badgeClassName: "border-yellow-500/30 bg-yellow-500/15 text-foreground shadow-sm dark:border-yellow-400/30 dark:bg-yellow-400/15",
      dotClassName: "bg-yellow-500 ring-1 ring-yellow-500/40 dark:bg-yellow-400 dark:ring-yellow-400/40",
      calendarCellClassName: "border-yellow-500/30 bg-yellow-500/15 text-foreground dark:border-yellow-400/30 dark:bg-yellow-400/15",
      calendarInnerClassName: "bg-yellow-500/15 dark:bg-yellow-400/15",
      recordStatusClassName: "border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
    },
    sick_leave: {
      label: t("recordEditor.sickLeave"),
      activeTriggerClassName: "data-[state=active]:border-rose-500/30 data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-700 dark:data-[state=active]:border-rose-400/30 dark:data-[state=active]:bg-rose-400/15 dark:data-[state=active]:text-rose-200",
      badgeClassName: "border-rose-500/30 bg-rose-500/15 text-foreground shadow-sm dark:border-rose-400/30 dark:bg-rose-400/15",
      dotClassName: "bg-rose-500 ring-1 ring-rose-500/40 dark:bg-rose-400 dark:ring-rose-400/40",
      calendarCellClassName: "border-rose-500/30 bg-rose-500/15 text-foreground dark:border-rose-400/30 dark:bg-rose-400/15",
      calendarInnerClassName: "bg-rose-500/15 dark:bg-rose-400/15",
      recordStatusClassName: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    },
    holiday: {
      label: t("calendar.publicHoliday"),
      activeTriggerClassName: "",
      badgeClassName: "border-border bg-muted text-foreground shadow-sm",
      dotClassName: "bg-muted-foreground/70 ring-1 ring-border",
      calendarCellClassName: "border-border bg-muted text-foreground",
      calendarInnerClassName: "bg-muted",
      recordStatusClassName: "",
    },
    mixed: {
      label: t("calendar.mixed"),
      activeTriggerClassName: "",
      badgeClassName: "border-violet-500/30 bg-violet-500/15 text-foreground shadow-sm dark:border-violet-400/30 dark:bg-violet-400/15",
      dotClassName: "bg-violet-500 ring-1 ring-violet-500/40 dark:bg-violet-400 dark:ring-violet-400/40",
      calendarCellClassName: "border-violet-500/30 bg-violet-500/15 text-foreground dark:border-violet-400/30 dark:bg-violet-400/15",
      calendarInnerClassName: "bg-violet-500/15 dark:bg-violet-400/15",
      recordStatusClassName: "",
    },
  };
}

export function getEntryTypeLabel(entryType: TimeEntryType, t: TFunction) {
  return getEntryStateUi(t)[entryType].label;
}
