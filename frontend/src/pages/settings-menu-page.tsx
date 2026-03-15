import { useEffect, useMemo, useState } from "react";
import type { CompanyCustomField, CompanySettings, TimeEntryType } from "@shared/types/models";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCompanyDateTime } from "@/lib/locale-format";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: "en-GB",
  dateTimeFormat: "g",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  country: "AT",
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
  };
}

function getLocalePreview(locale: string) {
  const sampleDate = new Date("2026-03-15T13:21:00");
  const normalizedLocale = locale.trim() || "en-GB";

  try {
    const decimalMark = new Intl.NumberFormat(normalizedLocale).formatToParts(3.14).find((part) => part.type === "decimal")?.value ?? ".";
    const dateFormat = new Intl.DateTimeFormat(normalizedLocale).format(sampleDate);
    const timeFormat = new Intl.DateTimeFormat(normalizedLocale, { hour: "numeric", minute: "numeric" }).format(sampleDate);
    const language =
      new Intl.DisplayNames([normalizedLocale], { type: "language" }).of(normalizedLocale.split("-")[0]) ?? normalizedLocale;

    return { decimalMark, dateFormat, timeFormat, language, isValid: true };
  } catch {
    return { decimalMark: ".", dateFormat: "15/03/2026", timeFormat: "13:21", language: "Invalid locale", isValid: false };
  }
}

function getDateTimeFormatPreview(locale: string, dateTimeFormat: string) {
  const sampleValue = "2026-03-15T13:21:00";

  try {
    return formatCompanyDateTime(sampleValue, locale, dateTimeFormat);
  } catch {
    return new Date(sampleValue).toLocaleString(locale || "en-GB");
  }
}

export function SettingsMenuPage() {
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => getLocalePreview(settings.locale), [settings.locale]);
  const dateTimePreview = useMemo(() => getDateTimeFormatPreview(settings.locale, settings.dateTimeFormat), [settings.dateTimeFormat, settings.locale]);
  const firstDayOptions = [
    { value: "0", label: "Sunday" },
    { value: "1", label: "Monday" },
    { value: "2", label: "Tuesday" },
    { value: "3", label: "Wednesday" },
    { value: "4", label: "Thursday" },
    { value: "5", label: "Friday" },
    { value: "6", label: "Saturday" },
  ];
  const fieldTypeOptions = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "date", label: "Date" },
    { value: "boolean", label: "Yes / no" },
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
        title: "Could not load settings",
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

  async function handleSave() {
    if (!companySession) return;
    try {
      for (const field of settings.customFields) {
        if (field.label.trim().length < 2) throw new Error("Each custom field needs a label");
        if (field.targets.length === 0) throw new Error(`${field.label || "Field"} needs at least one target`);
      }

      setSaving(true);
      const response = await api.updateSettings(companySession.token, {
        ...settings,
        customFields: settings.customFields.map((field) => ({
          ...field,
          label: field.label.trim(),
          placeholder: field.placeholder?.trim() || null,
        })),
      });
      setSettings(response.settings);
      toast({ title: "Settings saved" });
    } catch (error) {
      toast({
        title: "Could not save settings",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLabel title="Settings" description="Configure locale, limits, and the custom data users must fill for each entry type." />
      <FormPanel>
        <FormSection>
          <FormFields>
            <Field label="Currency">
              <Input placeholder="EUR" maxLength={3} value={settings.currency} onChange={(event) => setSettings((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
            </Field>
            <Field label="Locale">
              <Input placeholder="en-GB" value={settings.locale} onChange={(event) => setSettings((current) => ({ ...current, locale: event.target.value }))} />
            </Field>
            <Field label="First day of week">
              <FieldCombobox
                label="first day"
                value={String(settings.firstDayOfWeek)}
                onValueChange={(value) => setSettings((current) => ({ ...current, firstDayOfWeek: Number(value) }))}
                items={firstDayOptions}
              />
            </Field>
            <Field label="Date and time format">
              <Input
                placeholder="g"
                value={settings.dateTimeFormat}
                onChange={(event) => setSettings((current) => ({ ...current, dateTimeFormat: event.target.value }))}
              />
            </Field>
            <Field label="Edit days limit">
              <Input placeholder="30" type="number" min="0" value={settings.editDaysLimit} onChange={(event) => setSettings((current) => ({ ...current, editDaysLimit: Number(event.target.value) }))} />
            </Field>
            <Field label="Insert days limit">
              <Input placeholder="30" type="number" min="0" value={settings.insertDaysLimit} onChange={(event) => setSettings((current) => ({ ...current, insertDaysLimit: Number(event.target.value) }))} />
            </Field>
            <Field label="Country">
              <Input placeholder="AT" maxLength={2} value={settings.country} onChange={(event) => setSettings((current) => ({ ...current, country: event.target.value.toUpperCase() }))} />
            </Field>
          </FormFields>
        </FormSection>

        <FormSection>
          <div className="rounded-2xl border border-border p-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Language</span>
              <span>{preview.language}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Decimal mark</span>
              <span>{preview.decimalMark}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Date format</span>
              <span>{preview.dateFormat}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Time format</span>
              <span>{preview.timeFormat}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Date-time preview</span>
              <span>{dateTimePreview}</span>
            </div>
          </div>
        </FormSection>

        <FormSection>
          <div className="flex items-center justify-between">
            <PageLabel title="Custom fields" description="Define the extra data users must fill for working, vacation, or sick leave." />
            <Button variant="outline" onClick={() => setSettings((current) => ({ ...current, customFields: [...current.customFields, createField()] }))} type="button">
              Add field
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {settings.customFields.map((field, index) => (
              <div key={field.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4">
                <FormFields>
                  <Field label="Label">
                    <Input placeholder="Client code" value={field.label} onChange={(event) => setField(index, { ...field, label: event.target.value })} />
                  </Field>
                  <Field label="Type">
                    <FieldCombobox
                      label="field type"
                      value={field.type}
                      onValueChange={(value) => setField(index, { ...field, type: value as CompanyCustomField["type"] })}
                      items={fieldTypeOptions}
                    />
                  </Field>
                  <Field label="Placeholder">
                    <Input placeholder="Enter client code" value={field.placeholder ?? ""} onChange={(event) => setField(index, { ...field, placeholder: event.target.value || null })} />
                  </Field>
                  <Field label="Required">
                    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
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
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={() => setSettings((current) => ({ ...current, customFields: current.customFields.filter((_, fieldIndex) => fieldIndex !== index) }))} type="button">
                    Remove field
                  </Button>
                </div>
              </div>
            ))}

            {settings.customFields.length === 0 ? <p className="text-sm text-muted-foreground">No custom fields yet.</p> : null}
          </div>
        </FormSection>

        <FormActions>
          <Button disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? "Saving..." : "Save"}
          </Button>
        </FormActions>
      </FormPanel>
    </FormPage>
  );
}
