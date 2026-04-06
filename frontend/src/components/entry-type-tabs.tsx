import { Briefcase, ClockCounterClockwise, FirstAidKit, UmbrellaSimple } from "phosphor-react";
import type { TimeEntryType } from "@shared/types/models";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface EntryTypeTabItem {
  value: TimeEntryType;
  label: string;
}

interface EntryTypeTabsProps {
  value: TimeEntryType;
  onValueChange: (value: TimeEntryType) => void;
  items: EntryTypeTabItem[];
}

function getEntryTypeIcon(entryType: TimeEntryType) {
  if (entryType === "work") return Briefcase;
  if (entryType === "vacation") return UmbrellaSimple;
  if (entryType === "time_off_in_lieu") return ClockCounterClockwise;
  return FirstAidKit;
}

export function EntryTypeTabs({ value, onValueChange, items }: EntryTypeTabsProps) {
  const { t } = useTranslation();
  const entryStateUi = getEntryStateUi(t);
  const triggerBaseClassName =
    "inline-flex min-w-0 items-center justify-center rounded-md border min-h-10 text-sm font-medium leading-5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div role="tablist" aria-label={t("recordEditor.entryType")} className="flex w-full min-w-0 flex-wrap gap-1">
      {items.map((item) => {
        const Icon = getEntryTypeIcon(item.value);
        const isActive = value === item.value;

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={item.label}
            title={item.label}
            onClick={() => onValueChange(item.value)}
            className={cn(
              triggerBaseClassName,
              isActive
                ? "flex-1 gap-1.5 px-3 py-2"
                : "w-10 shrink-0 gap-0 px-0 py-2 sm:w-11",
              isActive
                ? cn(
                    "shadow-none",
                    entryStateUi[item.value].tabActiveClassName,
                  )
                : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              <Icon size={16} weight="duotone" className="shrink-0 opacity-90 sm:h-[18px] sm:w-[18px]" />
            </span>
            {isActive ? <span className="min-w-0 truncate text-center leading-5">{item.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
