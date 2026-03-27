import type { CompanyCustomField } from "@shared/types/models";
import { normalizeCustomFieldValue } from "@shared/utils/custom-fields";
import { FieldCombobox } from "@/components/form-layout";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface CustomFieldInputProps {
  field: CompanyCustomField;
  value: string | number | boolean | undefined;
  locale: string;
  onValueChange: (value: string | number | boolean | undefined) => void;
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

export function CustomFieldInput({ field, value, locale, onValueChange, booleanLabels }: CustomFieldInputProps) {
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
    const normalizedValue = normalizeCustomFieldValue(field, value);
    return (
      <FieldCombobox
        label={field.label}
        value={typeof normalizedValue === "string" ? normalizedValue : ""}
        onValueChange={onValueChange}
        items={field.options.map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        placeholder={field.placeholder ?? field.label}
      />
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
