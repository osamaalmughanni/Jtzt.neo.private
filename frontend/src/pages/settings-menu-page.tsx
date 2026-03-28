import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CompanySettings, TabletCodeStatus } from "@shared/types/models";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { Switch } from "@/components/ui/switch";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCompanyDateTime } from "@/lib/locale-format";
import { toast } from "@/lib/toast";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";
import { buildCountryOptions, buildCurrencyOptions, buildLocaleOptions, buildTimeZoneOptions } from "@/lib/company-option-lists";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: DEFAULT_COMPANY_LOCALE,
  timeZone: DEFAULT_COMPANY_TIME_ZONE,
  dateTimeFormat: DEFAULT_COMPANY_DATE_TIME_FORMAT,
  firstDayOfWeek: 1,
  weekendDays: [...DEFAULT_COMPANY_WEEKEND_DAYS],
  editDaysLimit: 30,
  insertDaysLimit: 30,
  allowOneRecordPerDay: false,
  allowIntersectingRecords: false,
  allowRecordsOnHolidays: true,
  allowRecordsOnWeekends: true,
  allowFutureRecords: false,
  country: "AT",
  tabletIdleTimeoutSeconds: 10,
  autoBreakAfterMinutes: 300,
  autoBreakDurationMinutes: 30,
  projectsEnabled: false,
  tasksEnabled: false,
  customFields: [],
  overtime: createDefaultOvertimeSettings(),
};

const defaultTabletCode: TabletCodeStatus = {
  configured: false,
  code: null,
  updatedAt: null
};

function getLocalePreview(locale: string) {
  const sampleDate = new Date("2026-03-15T13:21:00");
  const normalizedLocale = locale.trim() || DEFAULT_COMPANY_LOCALE;

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

function getDateTimeFormatPreview(locale: string, dateTimeFormat: string, timeZone: string) {
  const sampleValue = "2026-03-15T13:21:00";

  try {
    return formatCompanyDateTime(sampleValue, locale, dateTimeFormat, timeZone);
  } catch {
    return new Date(sampleValue).toLocaleString(locale || DEFAULT_COMPANY_LOCALE, { timeZone });
  }
}

export function SettingsMenuPage() {
  const { t, i18n } = useTranslation();
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [tabletCodeStatus, setTabletCodeStatus] = useState<TabletCodeStatus>(defaultTabletCode);
  const [tabletCodeInput, setTabletCodeInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [tabletSaving, setTabletSaving] = useState(false);
  const pageResource = usePageResource<{ settings: CompanySettings; tabletCodeStatus: TabletCodeStatus }>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
    load: async () => {
      if (!companySession) {
        return { settings: defaultSettings, tabletCodeStatus: defaultTabletCode };
      }

      try {
        const [settingsResponse, tabletCodeResponse] = await Promise.all([
          api.getSettings(companySession.token),
          api.getTabletCodeStatus(companySession.token)
        ]);
        return {
          settings: settingsResponse.settings,
          tabletCodeStatus: tabletCodeResponse.tabletCode
        };
      } catch (error) {
        toast({
          title: t("settings.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    }
  });
  const preview = useMemo(() => getLocalePreview(settings.locale), [settings.locale]);
  const dateTimePreview = useMemo(() => getDateTimeFormatPreview(settings.locale, settings.dateTimeFormat, settings.timeZone), [settings.dateTimeFormat, settings.locale, settings.timeZone]);
  const uiLocale = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_COMPANY_LOCALE;
  const localeOptions = useMemo(() => buildLocaleOptions(uiLocale), [uiLocale]);
  const timeZoneOptions = useMemo(() => buildTimeZoneOptions(), []);
  const countryOptions = useMemo(() => buildCountryOptions(uiLocale), [uiLocale]);
  const currencyOptions = useMemo(() => buildCurrencyOptions(uiLocale), [uiLocale]);
  const weekdayOptions = [
    { value: 1, label: t("settings.monday") },
    { value: 2, label: t("settings.tuesday") },
    { value: 3, label: t("settings.wednesday") },
    { value: 4, label: t("settings.thursday") },
    { value: 5, label: t("settings.friday") },
    { value: 6, label: t("settings.saturday") },
    { value: 7, label: t("settings.sunday") },
  ];
  const firstDayOptions = [
    { value: "0", label: t("settings.sunday") },
    { value: "1", label: t("settings.monday") },
    { value: "2", label: t("settings.tuesday") },
    { value: "3", label: t("settings.wednesday") },
    { value: "4", label: t("settings.thursday") },
    { value: "5", label: t("settings.friday") },
    { value: "6", label: t("settings.saturday") },
  ];
  async function refreshTabletCodeStatus() {
    if (!companySession) return;
    const response = await api.getTabletCodeStatus(companySession.token);
    setTabletCodeStatus(response.tabletCode);
    setTabletCodeInput(response.tabletCode.code ?? "");
  }

  useEffect(() => {
    if (!pageResource.data) {
      return;
    }

    setSettings(pageResource.data.settings);
    setTabletCodeStatus(pageResource.data.tabletCodeStatus);
    setTabletCodeInput(pageResource.data.tabletCodeStatus.code ?? "");
  }, [pageResource.data]);

  async function handleSave() {
    if (!companySession) return;
    try {
      setSaving(true);
      const nextTabletCode = tabletCodeInput.trim();
      if (nextTabletCode.length > 0 && nextTabletCode !== (tabletCodeStatus.code ?? "")) {
        await api.updateTabletCode(companySession.token, { code: nextTabletCode });
      }
      const response = await api.updateSettings(companySession.token, settings);
      setSettings(response.settings);
      await refreshTabletCodeStatus();
      toast({ title: t("settings.saved") });
    } catch (error) {
      toast({
        title: t("settings.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTabletCode() {
    if (!companySession) return;
    try {
      setTabletSaving(true);
      await api.updateTabletCode(companySession.token, { code: tabletCodeInput });
      await refreshTabletCodeStatus();
      toast({ title: t("settings.saveTabletCode") });
    } catch (error) {
      toast({
        title: t("settings.saveTabletCodeFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setTabletSaving(false);
    }
  }

  async function handleRegenerateTabletCode() {
    if (!companySession) return;
    try {
      setTabletSaving(true);
      await api.regenerateTabletCode(companySession.token);
      await refreshTabletCodeStatus();
      toast({ title: t("settings.regenerateTabletCode") });
    } catch (error) {
      toast({
        title: t("settings.regenerateTabletCodeFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setTabletSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("settings.title")} description={t("settings.description")} />
          </PageIntro>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
      <FormPanel>
        <FormSection>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1.5 pb-4">
              <p className="text-sm font-medium text-foreground">{t("settings.localeGroupTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.localeGroupDescription")}</p>
            </div>
            <div className="flex flex-col gap-4">
              <Field label={t("settings.currency")}>
                <Combobox
                  value={settings.currency}
                  onValueChange={(value) => setSettings((current) => ({ ...current, currency: value.toUpperCase() }))}
                  options={currencyOptions}
                  placeholder="EUR"
                  searchPlaceholder={t("common.search", { defaultValue: "Search..." })}
                  emptyText={t("common.noResults", { defaultValue: "No results found." })}
                  searchable
                />
              </Field>
              <Field label={t("settings.locale")}>
                <Combobox
                  value={settings.locale}
                  onValueChange={(value) => setSettings((current) => ({ ...current, locale: value }))}
                  options={localeOptions}
                  placeholder={DEFAULT_COMPANY_LOCALE}
                  searchPlaceholder={t("common.search", { defaultValue: "Search..." })}
                  emptyText={t("common.noResults", { defaultValue: "No results found." })}
                  searchable
                />
              </Field>
              <Field label={t("settings.timeZone")}>
                <Combobox
                  value={settings.timeZone}
                  onValueChange={(value) => setSettings((current) => ({ ...current, timeZone: value }))}
                  options={timeZoneOptions}
                  placeholder={DEFAULT_COMPANY_TIME_ZONE}
                  searchPlaceholder={t("common.search", { defaultValue: "Search..." })}
                  emptyText={t("common.noResults", { defaultValue: "No results found." })}
                  searchable
                />
              </Field>
              <Field label={t("settings.country")}>
                <Combobox
                  value={settings.country}
                  onValueChange={(value) => setSettings((current) => ({ ...current, country: value.toUpperCase() }))}
                  options={countryOptions}
                  placeholder="AT"
                  searchPlaceholder={t("common.search", { defaultValue: "Search..." })}
                  emptyText={t("common.noResults", { defaultValue: "No results found." })}
                  searchable
                />
              </Field>
              <Field label={t("settings.firstDayOfWeek")}>
                <FieldCombobox
                  label={t("settings.firstDayOfWeek")}
                  value={String(settings.firstDayOfWeek)}
                  onValueChange={(value) => setSettings((current) => ({ ...current, firstDayOfWeek: Number(value) }))}
                  items={firstDayOptions}
                />
              </Field>
              <Field label={t("settings.weekendDays")}>
                <div className="flex flex-col gap-1.5">
                  <MultiSelectCombobox
                    value={settings.weekendDays.map(String)}
                    onValueChange={(value) =>
                      setSettings((current) => ({
                        ...current,
                        weekendDays: (() => {
                          const next = value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
                          return next.length > 0 ? next : current.weekendDays;
                        })(),
                      }))
                    }
                    options={weekdayOptions.map((day) => ({ value: String(day.value), label: day.label }))}
                    placeholder={t("settings.weekendDays")}
                    searchPlaceholder={t("common.search", { defaultValue: "Search..." })}
                    emptyText={t("common.noResults", { defaultValue: "No results found." })}
                    searchable
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.weekendDaysDescription")}</p>
                </div>
              </Field>
              <Field label={t("settings.dateTimeFormat")}>
                <div className="flex flex-col gap-1.5">
                  <Input
                    placeholder={DEFAULT_COMPANY_DATE_TIME_FORMAT}
                    value={settings.dateTimeFormat}
                    onChange={(event) => setSettings((current) => ({ ...current, dateTimeFormat: event.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.dateTimeFormatHint")}</p>
                </div>
              </Field>
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-sm">
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                <span className="text-muted-foreground">{t("settings.language")}</span>
                <span>{preview.language}</span>
                <span className="text-muted-foreground">{t("settings.decimalMark")}</span>
                <span>{preview.decimalMark}</span>
                <span className="text-muted-foreground">{t("settings.dateFormat")}</span>
                <span>{preview.dateFormat}</span>
                <span className="text-muted-foreground">{t("settings.timeFormat")}</span>
                <span>{preview.timeFormat}</span>
                <span className="text-muted-foreground">{t("settings.dateTimePreview")}</span>
                <span>{dateTimePreview}</span>
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1.5 pb-4">
              <p className="text-sm font-medium text-foreground">{t("settings.rulesGroupTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.rulesGroupDescription")}</p>
            </div>
            <FormFields>
              <Field label={t("settings.editDaysLimit")}>
                <Input placeholder="30" type="number" min="0" value={settings.editDaysLimit} onChange={(event) => setSettings((current) => ({ ...current, editDaysLimit: Number(event.target.value) }))} />
              </Field>
              <Field label={t("settings.insertDaysLimit")}>
                <Input placeholder="30" type="number" min="0" value={settings.insertDaysLimit} onChange={(event) => setSettings((current) => ({ ...current, insertDaysLimit: Number(event.target.value) }))} />
              </Field>
              <Field label={t("settings.oneRecordPerDay")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.allowOneRecordPerDay ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.allowOneRecordPerDay}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        allowOneRecordPerDay: checked,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.allowIntersectingRecords")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.allowIntersectingRecords ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.allowIntersectingRecords}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        allowIntersectingRecords: checked,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.allowRecordsOnHolidays")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.allowRecordsOnHolidays ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.allowRecordsOnHolidays}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        allowRecordsOnHolidays: checked,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.allowRecordsOnWeekends")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.allowRecordsOnWeekends ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.allowRecordsOnWeekends}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        allowRecordsOnWeekends: checked,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.allowFutureRecords")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.allowFutureRecords ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.allowFutureRecords}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        allowFutureRecords: checked,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.projectsEnabled")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.projectsEnabled ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.projectsEnabled}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        projectsEnabled: checked,
                        tasksEnabled: checked ? current.tasksEnabled : false,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("settings.tasksEnabled")}>
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3">
                  <span className="text-sm text-foreground">
                    {settings.tasksEnabled ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                  <Switch
                    checked={settings.tasksEnabled}
                    disabled={!settings.projectsEnabled}
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        projectsEnabled: checked ? true : current.projectsEnabled,
                        tasksEnabled: checked,
                      }))
                    }
                  />
                </div>
              </Field>
            </FormFields>
          </div>
        </FormSection>

        <FormSection>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1.5 pb-4">
              <p className="text-sm font-medium text-foreground">{t("settings.timeGroupTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.timeGroupDescription")}</p>
            </div>
            <FormFields>
              <Field label={t("settings.tabletIdleTimeoutSeconds")}>
                <Input
                  placeholder="10"
                  type="number"
                  min="0"
                  value={settings.tabletIdleTimeoutSeconds}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      tabletIdleTimeoutSeconds: Math.max(0, Number(event.target.value || 0)),
                    }))
                  }
                />
              </Field>
              <Field label={t("settings.autoBreakAfterHours")}>
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
              <Field label={t("settings.autoBreakDurationMinutes")}>
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
          </div>
        </FormSection>

        <FormSection>
          <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">{t("settings.tabletAccess")}</p>
              <p className="text-sm text-muted-foreground">
                {t("settings.tabletAccessDescription")}
              </p>
            </div>
            <FormFields>
              <Field label={t("settings.tabletCode")}>
                <Input
                  placeholder={t("auth.tabletCodePlaceholder")}
                  value={tabletCodeInput}
                  onChange={(event) => setTabletCodeInput(event.target.value)}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {tabletCodeStatus.configured ? t("settings.tabletModeActive") : t("settings.noTabletCode")}
                </span>
                {tabletCodeStatus.updatedAt ? (
                  <span className="text-muted-foreground">{formatCompanyDateTime(tabletCodeStatus.updatedAt, settings.locale, settings.dateTimeFormat, settings.timeZone)}</span>
                ) : null}
              </div>
              {tabletCodeStatus.code ? (
                <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm">
                  <p className="text-muted-foreground">{t("settings.currentCode")}</p>
                  <p className="text-base font-medium tracking-[0.16em] text-foreground">{tabletCodeStatus.code}</p>
                </div>
              ) : null}
            </FormFields>
            <div className="flex items-center gap-2">
              <Button
                disabled={tabletSaving || tabletCodeInput.trim().length === 0}
                onClick={() => void handleSaveTabletCode()}
                type="button"
              >
                {tabletSaving ? t("settings.saving") : tabletCodeStatus.configured ? t("settings.changeCode") : t("settings.createCode")}
              </Button>
              <Button disabled={tabletSaving} variant="ghost" onClick={() => void handleRegenerateTabletCode()} type="button">
                {t("settings.regenerate")}
              </Button>
            </div>
          </div>
        </FormSection>

        <FormSection>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-foreground">{t("settings.overtimeGroupTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.overtimeGroupDescription")}</p>
            </div>
            <div className="mt-4">
              <Button asChild type="button" variant="outline">
                <Link to="/settings/overtime">{t("settings.manageOvertime")}</Link>
              </Button>
            </div>
          </div>
        </FormSection>

        <FormActions>
          <Button disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? t("settings.saving") : t("settings.save")}
          </Button>
        </FormActions>
      </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
