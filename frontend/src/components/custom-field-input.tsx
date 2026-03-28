import { useEffect, useMemo } from "react";
import type { CompanyCustomField } from "@shared/types/models";
import { normalizeCustomFieldValue } from "@shared/utils/custom-fields";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface CustomFieldInputProps {
  field: CompanyCustomField;
  value: string | number | boolean | undefined;
  locale: string;
  onValueChange: (value: string | number | boolean | undefined) => void;
  density?: "default" | "compact";
  booleanLabels?: {
    yes: string;
    no: string;
  };
}

function CustomBooleanFieldInput({
  value,
  onValueChange,
  labels,
}: {
  value: boolean | undefined;
  onValueChange: (value: boolean | undefined) => void;
  labels: {
    yes: string;
    no: string;
  };
}) {
  const checked = value === true;

  return (
    <div className="flex items-center justify-between rounded-xl border border-input bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-3">
        <Switch
          checked={checked}
          onCheckedChange={(nextChecked) => onValueChange(nextChecked)}
          aria-label="Boolean field toggle"
        />
        <span className="text-sm font-medium text-foreground">{checked ? labels.yes : labels.no}</span>
      </div>
    </div>
  );
}

export function CustomFieldInput({ field, value, locale, onValueChange, density = "default", booleanLabels }: CustomFieldInputProps) {
  const normalizedValue = useMemo(() => normalizeCustomFieldValue(field, value), [field, value]);

  useEffect(() => {
    if (field.type !== "select") {
      return;
    }

    const firstOptionId = field.options[0]?.id;
    if (!firstOptionId) {
      return;
    }

    if (normalizedValue === undefined || normalizedValue === "") {
      onValueChange(firstOptionId);
    }
  }, [field.options, field.type, normalizedValue, onValueChange]);

  if (field.type === "boolean") {
    return (
      <CustomBooleanFieldInput
        value={typeof value === "boolean" ? value : undefined}
        onValueChange={onValueChange}
        labels={booleanLabels ?? { yes: "Yes", no: "No" }}
      />
    );
  }

  if (field.type === "select") {
    const selectedValue = typeof normalizedValue === "string"
      ? normalizedValue
      : field.options[0]?.id ?? "";

    return (
      <div role="radiogroup" aria-label={field.label} className={cn("flex flex-wrap", density === "compact" ? "gap-1" : "gap-1.5")}>
        {field.options.map((option) => {
          const selected = selectedValue === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              variant={selected ? "default" : "outline"}
              role="radio"
              aria-checked={selected}
              onClick={() => onValueChange(option.id)}
              className={cn(
                "h-auto w-auto items-center justify-start rounded-full whitespace-nowrap leading-none",
                density === "compact" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                selected
                  ? "border-foreground bg-foreground text-background hover:bg-foreground hover:opacity-90"
                  : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              <span className="text-inherit font-medium leading-none">
                {option.label}
              </span>
            </Button>
          );
        })}
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <DateInput
        value={typeof value === "string" ? value : ""}
        locale={locale}
        onChange={onValueChange}
      />
    );
  }

  return (
    <Input
      type={field.type === "number" ? "number" : "text"}
      placeholder={field.placeholder ?? field.label}
      value={value === undefined ? "" : String(value)}
      onChange={(event) => onValueChange(field.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)}
    />
  );
}
