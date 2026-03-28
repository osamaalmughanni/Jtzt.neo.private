import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MultiSelectComboboxOption {
  value: string;
  label: string;
  keywords?: string[];
}

interface MultiSelectComboboxProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: MultiSelectComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
}

export function MultiSelectCombobox({
  value,
  onValueChange,
  options,
  placeholder = "Select options",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  disabled = false,
  className,
  searchable = false,
}: MultiSelectComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedOptions = useMemo(
    () => options.filter((option) => value.includes(option.value)),
    [options, value],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;

    return options.filter((option) => {
      const haystack = [option.label, option.value, ...(option.keywords ?? [])].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    if (searchable) {
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function toggleValue(nextValue: string) {
    if (value.includes(nextValue)) {
      onValueChange(value.filter((item) => item !== nextValue));
      return;
    }

    onValueChange([...value, nextValue]);
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        className={cn("relative", disabled && "pointer-events-none opacity-50")}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <Input
          readOnly
          value={selectedOptions.map((option) => option.label).join(", ")}
          placeholder={placeholder}
          className="cursor-pointer pr-10"
        />
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
          <ChevronsUpDown className="h-4 w-4 shrink-0" />
        </span>
      </div>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 flex w-full flex-col gap-2 rounded-md border border-border bg-[hsl(var(--popover))] p-2 text-[hsl(var(--popover-foreground))] shadow-md">
          {searchable ? (
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          ) : null}
          <div className="max-h-60 overflow-y-auto" role="listbox">
            {filteredOptions.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</p> : null}
            {filteredOptions.map((option) => {
              const selected = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleValue(option.value);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  <Check className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
