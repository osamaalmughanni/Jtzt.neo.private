import { Briefcase, FirstAidKit, UmbrellaSimple } from "phosphor-react";
import type { TimeEntryType } from "@shared/types/models";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface EntryTypeTabItem {
  value: TimeEntryType;
  label: string;
  disabled?: boolean;
}

interface EntryTypeTabsProps {
  value: TimeEntryType;
  onValueChange: (value: TimeEntryType) => void;
  items: EntryTypeTabItem[];
}

function getEntryTypeIcon(entryType: TimeEntryType) {
  if (entryType === "work") {
    return Briefcase;
  }

  if (entryType === "vacation") {
    return UmbrellaSimple;
  }

  return FirstAidKit;
}

function getEntryTypeTriggerClassName(entryType: TimeEntryType) {
  if (entryType === "work") {
    return "data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-700 dark:data-[state=active]:border-emerald-400/30 dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-200";
  }

  if (entryType === "vacation") {
    return "data-[state=active]:border-sky-500/30 data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-700 dark:data-[state=active]:border-sky-400/30 dark:data-[state=active]:bg-sky-400/15 dark:data-[state=active]:text-sky-200";
  }

  return "data-[state=active]:border-rose-500/30 data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-700 dark:data-[state=active]:border-rose-400/30 dark:data-[state=active]:bg-rose-400/15 dark:data-[state=active]:text-rose-200";
}

export function EntryTypeTabs({ value, onValueChange, items }: EntryTypeTabsProps) {
  return (
    <Tabs value={value} onValueChange={(nextValue) => onValueChange(nextValue as TimeEntryType)}>
      <div className="py-1">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-auto w-max min-w-0 gap-2 rounded-2xl bg-transparent p-0 text-foreground">
            {items.map((item) => {
              const Icon = getEntryTypeIcon(item.value);

              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={cn(
                    "group rounded-2xl border border-border bg-muted/60 px-3 py-2 text-muted-foreground shadow-none transition-all duration-200 ease-out",
                    "data-[state=active]:px-4 data-[state=active]:shadow-sm disabled:pointer-events-none disabled:opacity-40",
                    getEntryTypeTriggerClassName(item.value),
                  )}
                >
                  <span className="flex items-center">
                    <Icon size={18} weight="duotone" className="shrink-0" />
                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap text-sm opacity-0 transition-all duration-200 ease-out group-data-[state=active]:ml-2 group-data-[state=active]:max-w-28 group-data-[state=active]:opacity-100">
                      {item.label}
                    </span>
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
      </div>
    </Tabs>
  );
}
