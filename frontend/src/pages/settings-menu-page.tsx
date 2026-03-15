import { useEffect, useMemo, useState } from "react";
import type { CompanySettings } from "@shared/types/models";
import { FormActions, FormFields, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  trackingMode: "time",
  recordType: "start_finish",
  currency: "EUR",
  locale: "en-GB",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  country: "AT"
};

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
    return {
      decimalMark: ".",
      dateFormat: "15/03/2026",
      timeFormat: "13:21",
      language: "Invalid locale",
      isValid: false
    };
  }
}

export function SettingsMenuPage() {
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const trackingModeOptions = [
    { value: "time", label: "Time" },
    { value: "project", label: "Project" },
    { value: "project_and_tasks", label: "Project and tasks" }
  ];
  const recordTypeOptions = [
    { value: "all", label: "All" },
    { value: "start_finish", label: "Start and finish" },
    { value: "duration", label: "Duration" }
  ];
  const firstDayOptions = [
    { value: "1", label: "Monday" },
    { value: "0", label: "Sunday" },
    { value: "6", label: "Saturday" }
  ];

  useEffect(() => {
    if (!companySession) return;
    void api.getSettings(companySession.token).then((response) => setSettings(response.settings)).catch((error) =>
      toast({
        title: "Could not load settings",
        description: error instanceof Error ? error.message : "Request failed"
      })
    );
  }, [companySession]);

  const preview = useMemo(() => getLocalePreview(settings.locale), [settings.locale]);

  async function handleSave() {
    if (!companySession) return;
    try {
      setSaving(true);
      const response = await api.updateSettings(companySession.token, settings);
      setSettings(response.settings);
      toast({ title: "Settings saved" });
    } catch (error) {
      toast({
        title: "Could not save settings",
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLabel title="Settings" description="Configure tracking, locale, and company behavior." />
      <FormPanel>
        <FormSection>
          <FormFields>
            <Field label="Tracking mode">
              <FieldCombobox
                label="tracking mode"
                value={settings.trackingMode}
                onValueChange={(value) => setSettings((current) => ({ ...current, trackingMode: value as CompanySettings["trackingMode"] }))}
                items={trackingModeOptions}
              />
            </Field>
            <Field label="Record type">
              <FieldCombobox
                label="record type"
                value={settings.recordType}
                onValueChange={(value) => setSettings((current) => ({ ...current, recordType: value as CompanySettings["recordType"] }))}
                items={recordTypeOptions}
              />
            </Field>
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
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-muted-foreground">Decimal mark</span>
              <span>{preview.decimalMark}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-muted-foreground">Date format</span>
              <span>{preview.dateFormat}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-muted-foreground">Time format</span>
              <span>{preview.timeFormat}</span>
            </div>
            {!preview.isValid ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Enter a valid locale like `en-GB`, `de-AT`, or `en-US` to update the preview.
              </p>
            ) : null}
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
