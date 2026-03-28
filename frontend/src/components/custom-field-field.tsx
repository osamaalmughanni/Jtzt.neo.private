import type { CompanyCustomField } from "@shared/types/models";
import { Field } from "@/components/form-layout";
import { CustomFieldInput } from "@/components/custom-field-input";

interface CustomFieldFieldProps {
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

export function CustomFieldField({
  field,
  value,
  locale,
  onValueChange,
  density = "default",
  booleanLabels,
}: CustomFieldFieldProps) {
  return (
    <Field label={field.label} description={field.description?.trim() || undefined}>
      <CustomFieldInput
        field={field}
        value={value}
        locale={locale}
        onValueChange={onValueChange}
        density={density}
        booleanLabels={booleanLabels}
      />
    </Field>
  );
}
