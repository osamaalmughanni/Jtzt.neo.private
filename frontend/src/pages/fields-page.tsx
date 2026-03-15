import { useEffect, useState } from "react";
import type { CompanyCustomField, CompanyCustomFieldOption, CompanySettings, TimeEntryType } from "@shared/types/models";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormSection } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: "en-GB",
  dateTimeFormat: "g",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  allowOneRecordPerDay: false,
  allowIntersectingRecords: false,
  country: "AT",
  tabletIdleTimeoutSeconds: 10,
  autoBreakAfterMinutes: 300,
  autoBreakDurationMinutes: 30,
  customFields: [],
};

function createField(): CompanyCustomField {
  return {
    id: crypto.randomUUID(),
    label: "",
    type: "text",
    targets: ["work"],
    required: false,
    placeholder: null,
    options: [],
  };
}

function createOption(): CompanyCustomFieldOption {
  return {
    id: crypto.randomUUID(),
    label: "",
    value: "",
  };
}

export function FieldsPage() {
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const fieldTypeOptions = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "date", label: "Date" },
    { value: "boolean", label: "Yes / no" },
    { value: "select", label: "Select" },
  ];
  const targetOptions: Array<{ value: TimeEntryType; label: string }> = [
    { value: "work", label: "Working" },
    { value: "vacation", label: "Vacation" },
    { value: "sick_leave", label: "Sick leave" },
  ];

  useEffect(() => {
    if (!companySession) return;
    void api.getSettings(companySession.token).then((response) => setSettings(response.settings)).catch((error) =>
      toast({
        title: "Could not load fields",
        description: error instanceof Error ? error.message : "Request failed",
      }),
    );
  }, [companySession]);

  function setField(index: number, nextField: CompanyCustomField) {
    setSettings((current) => ({
      ...current,
      customFields: current.customFields.map((field, fieldIndex) => (fieldIndex === index ? nextField : field)),
    }));
  }

  function toggleTarget(index: number, target: TimeEntryType) {
    const field = settings.customFields[index];
    const nextTargets = field.targets.includes(target)
      ? field.targets.filter((value) => value !== target)
      : [...field.targets, target];

    setField(index, {
      ...field,
      targets: nextTargets.length > 0 ? nextTargets : [target],
    });
  }

  function setOption(fieldIndex: number, optionIndex: number, nextOption: CompanyCustomFieldOption) {
    const field = settings.customFields[fieldIndex];
    setField(fieldIndex, {
      ...field,
      options: field.options.map((option, currentIndex) => (currentIndex === optionIndex ? nextOption : option)),
    });
  }

  async function handleSave() {
    if (!companySession) return;

    try {
      const cleanedFields = settings.customFields.map((field) => {
        const cleanedField = {
          ...field,
          label: field.label.trim(),
          placeholder: field.placeholder?.trim() || null,
          options: field.options.map((option) => ({
            ...option,
            label: option.label.trim(),
            value: option.value.trim(),
          })),
        };

        if (cleanedField.label.length < 2) {
          throw new Error("Each field needs a label");
        }

        if (cleanedField.targets.length === 0) {
          throw new Error(`${cleanedField.label} needs at least one target`);
        }

        if (cleanedField.type === "select") {
          const validOptions = cleanedField.options.filter((option) => option.label.length > 0 && option.value.length > 0);
          if (validOptions.length === 0) {
            throw new Error(`${cleanedField.label} needs at least one option`);
          }
          cleanedField.options = validOptions;
        } else {
          cleanedField.options = [];
        }

        return cleanedField;
      });

      setSaving(true);
      const response = await api.updateSettings(companySession.token, {
        ...settings,
        customFields: cleanedFields,
      });
      setSettings(response.settings);
      toast({ title: "Fields saved" });
    } catch (error) {
      toast({
        title: "Could not save fields",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLabel title="Fields" description="Define the custom data users must fill for working, vacation, or sick leave." />
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Create fields with their type, targets, and predefined options.</p>
        <Button variant="outline" onClick={() => setSettings((current) => ({ ...current, customFields: [...current.customFields, createField()] }))} type="button">
          Add field
        </Button>
      </div>

      <FormSection>
        <div className="flex flex-col gap-4">
          {settings.customFields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">
                    {field.label.trim() || `Field ${index + 1}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {field.type === "select" ? "Select with predefined options" : `Type: ${field.type}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      customFields: current.customFields.filter((_, fieldIndex) => fieldIndex !== index),
                    }))
                  }
                  type="button"
                >
                  Remove field
                </Button>
              </div>

              <FormFields>
                <Field label="Label">
                  <Input placeholder="Client code" value={field.label} onChange={(event) => setField(index, { ...field, label: event.target.value })} />
                </Field>
                <Field label="Type">
                  <FieldCombobox
                    label="field type"
                    value={field.type}
                    onValueChange={(value) => {
                      const nextType = value as CompanyCustomField["type"];
                      setField(index, {
                        ...field,
                        type: nextType,
                        options: nextType === "select" ? (field.options.length > 0 ? field.options : [createOption()]) : [],
                      });
                    }}
                    items={fieldTypeOptions}
                  />
                </Field>
                <Field label="Placeholder">
                  <Input placeholder="Enter client code" value={field.placeholder ?? ""} onChange={(event) => setField(index, { ...field, placeholder: event.target.value || null })} />
                </Field>
                <Field label="Required">
                  <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                    <span className="text-sm text-foreground">User must fill this field</span>
                    <Switch checked={field.required} onCheckedChange={(checked) => setField(index, { ...field, required: checked })} />
                  </div>
                </Field>
                <Field label="Applies to">
                  <div className="flex flex-wrap gap-2">
                    {targetOptions.map((target) => (
                      <Button
                        key={target.value}
                        variant={field.targets.includes(target.value) ? "default" : "outline"}
                        onClick={() => toggleTarget(index, target.value)}
                        type="button"
                      >
                        {target.label}
                      </Button>
                    ))}
                  </div>
                </Field>
              </FormFields>

              {field.type === "select" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Options</p>
                    <Button
                      variant="ghost"
                      onClick={() => setField(index, { ...field, options: [...field.options, createOption()] })}
                      type="button"
                    >
                      Add option
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {field.options.map((option, optionIndex) => (
                      <div key={option.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                        <FormFields>
                          <Field label="Option label">
                            <Input placeholder="On-site" value={option.label} onChange={(event) => setOption(index, optionIndex, { ...option, label: event.target.value })} />
                          </Field>
                          <Field label="Stored value">
                            <Input placeholder="on_site" value={option.value} onChange={(event) => setOption(index, optionIndex, { ...option, value: event.target.value })} />
                          </Field>
                        </FormFields>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            onClick={() => setField(index, { ...field, options: field.options.filter((_, currentIndex) => currentIndex !== optionIndex) })}
                            type="button"
                          >
                            Remove option
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {settings.customFields.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">No fields yet.</p>
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormActions>
        <Button disabled={saving} onClick={() => void handleSave()} type="button">
          {saving ? "Saving..." : "Save"}
        </Button>
      </FormActions>
    </FormPage>
  );
}
