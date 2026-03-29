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

  return (
    <div role="tablist" aria-label={t("recordEditor.entryType")} className="flex w-full min-w-0 gap-1 overflow-x-auto overflow-y-hidden">
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
              "inline-flex min-w-0 shrink-0 items-center justify-start rounded-md border px-3 py-2.5 text-base font-semibold leading-none outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive ? "flex-none gap-1.5" : "flex-none gap-0.5",
              isActive
                ? cn(
                    "shadow-none",
                    entryStateUi[item.value].tabActiveClassName,
                  )
                : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              <Icon size={18} weight="duotone" className="shrink-0 opacity-90" />
            </span>
            {isActive ? <span className="min-w-0 whitespace-nowrap text-base">{item.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
