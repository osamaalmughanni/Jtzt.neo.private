import { useEffect, useMemo, useState } from "react";
import type { CompanySettings } from "@shared/types/models";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  autoBreakAfterMinutes: 300,
  autoBreakDurationMinutes: 30,
  customFields: [],
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
  useEffect(() => {
    if (!companySession) return;
    void api.getSettings(companySession.token).then((response) => setSettings(response.settings)).catch((error) =>
      toast({
        title: "Could not load settings",
        description: error instanceof Error ? error.message : "Request failed",
      }),
    );
  }, [companySession]);

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
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLabel title="Settings" description="Configure locale, limits, and the company-wide behavior." />
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
            <Field label="Auto break after hours">
              <Input
                placeholder="5"
                type="number"
                min="0"
                step="0.25"
                value={settings.autoBreakAfterMinutes / 60}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    autoBreakAfterMinutes: Math.max(0, Math.round(Number(event.target.value || 0) * 60)),
                  }))
                }
              />
            </Field>
            <Field label="Auto break duration minutes">
              <Input
                placeholder="30"
                type="number"
                min="0"
                value={settings.autoBreakDurationMinutes}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    autoBreakDurationMinutes: Math.max(0, Number(event.target.value || 0)),
                  }))
                }
              />
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

        <FormActions>
          <Button disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? "Saving..." : "Save"}
          </Button>
        </FormActions>
      </FormPanel>
    </FormPage>
  );
}
