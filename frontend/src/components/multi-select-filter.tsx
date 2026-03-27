import { CheckCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

export type MultiSelectFilterOption = {
  value: string;
  label: string;
};

interface MultiSelectFilterProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectFilterOption[];
  searchPlaceholder: string;
  emptyText: string;
  selectAllLabel?: string;
  clearLabel?: string;
}

export function MultiSelectFilter({
  value,
  onChange,
  options,
  searchPlaceholder,
  emptyText,
  selectAllLabel = "Select all",
  clearLabel = "Clear selection",
}: MultiSelectFilterProps) {
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch));
  }, [options, search]);

  function toggle(nextValue: string) {
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }

    onChange([...value, nextValue]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          aria-label={selectAllLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
          type="button"
          onClick={() => onChange(options.map((option) => option.value))}
        >
          <CheckCheck className="h-4 w-4" />
        </button>
        <button
          aria-label={clearLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
          type="button"
          onClick={() => onChange([])}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex max-h-56 flex-col overflow-y-auto rounded-2xl border border-border bg-background">
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          filteredOptions.map((option) => {
            const selected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${
                  selected ? "bg-muted text-foreground" : "bg-background text-foreground"
                }`}
                onClick={() => toggle(option.value)}
              >
                <span className="truncate text-foreground">{option.label}</span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-foreground" : "bg-border"}`} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
