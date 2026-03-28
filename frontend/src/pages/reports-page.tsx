import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CompanySettings, CompanyUserListItem } from "@shared/types/models";
import type { ReportRequestInput } from "@shared/types/api";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { formatLocalDay, getLocalNowSnapshot, parseLocalDay } from "@shared/utils/time";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompanySettings } from "@/lib/company-settings";
import { getCustomFieldOptionLabel, normalizeReportDraftFields } from "@/lib/report-fields";
import { createReportDraftId, loadReportDraft, saveReportDraft } from "@/lib/report-draft-storage";
import { toast } from "@/lib/toast";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { getCustomFieldsForTarget } from "@shared/utils/custom-fields";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";

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

type ReportOption = { value: string; label: string };

type ReportDraft = ReportRequestInput & {
  periodPreset: string;
};

function addDays(day: string, amount: number) {
  const parsed = parseLocalDay(day);
  if (!parsed) {
    return day;
  }

  parsed.setDate(parsed.getDate() + amount);
  return formatLocalDay(parsed);
}

function getMonthRange(day: string) {
  const date = parseLocalDay(day);
  if (!date) {
    return { startDate: day, endDate: day };
  }

  return {
    startDate: formatLocalDay(new Date(date.getFullYear(), date.getMonth(), 1)),
    endDate: formatLocalDay(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

function getLastMonthRange(day: string) {
  const date = parseLocalDay(day);
  if (!date) {
    return { startDate: day, endDate: day };
  }

  return getMonthRange(formatLocalDay(new Date(date.getFullYear(), date.getMonth() - 1, 1)));
}

function getYearRange(day: string) {
  const date = parseLocalDay(day);
  if (!date) {
    return { startDate: day, endDate: day };
  }

  return {
    startDate: formatLocalDay(new Date(date.getFullYear(), 0, 1)),
    endDate: formatLocalDay(new Date(date.getFullYear(), 11, 31)),
  };
}

function getWeekRange(day: string, firstDayOfWeek: number) {
  const date = parseLocalDay(day);
  if (!date) {
    return { startDate: day, endDate: day };
  }

  const normalizedFirstDayOfWeek =
    Number.isInteger(firstDayOfWeek) && firstDayOfWeek >= 0 && firstDayOfWeek <= 6
      ? firstDayOfWeek
      : 1;
  const weekday = date.getDay();
  const delta = (weekday - normalizedFirstDayOfWeek + 7) % 7;
  const startDate = addDays(day, -delta);
  return { startDate, endDate: addDays(startDate, 6) };
}

function applyPeriodPreset(periodPreset: string, settings: Pick<CompanySettings, "timeZone" | "firstDayOfWeek">) {
  const today = getLocalNowSnapshot(new Date(), settings.timeZone).localDay;
  if (periodPreset === "this_week") return getWeekRange(today, settings.firstDayOfWeek);
  if (periodPreset === "this_month") return getMonthRange(today);
  if (periodPreset === "last_month") return getLastMonthRange(today);
  if (periodPreset === "this_year") return getYearRange(today);
  return {
    startDate: today,
    endDate: today,
  };
}

function getAllFieldValues(baseFieldOptions: ReportOption[], customFieldOptions: ReportOption[]) {
  return [...baseFieldOptions, ...customFieldOptions].map((field) => field.value);
}

function createDefaultReportDraft(): ReportDraft {
  return {
    periodPreset: "this_month",
    ...applyPeriodPreset("this_month", defaultSettings),
    userIds: [],
    columns: [],
    groupBy: [],
    totalsOnly: false,
  };
}

export function ReportsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { companySession } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const draftId = searchParams.get("draft");
  const savedDraft = useMemo(() => loadReportDraft(draftId), [draftId]);
  const initializedDraftRef = useRef(false);
  const [draft, setDraft] = useState<ReportDraft>(() => savedDraft ?? createDefaultReportDraft());
  const pageResource = usePageResource<{ settings: CompanySettings; users: CompanyUserListItem[] }>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
    load: async () => {
      if (!companySession) {
        return { settings: defaultSettings, users: [] };
      }

      try {
        const usersResponse = await api.listUsers(companySession.token, true);
        return {
          settings: companySettings ?? defaultSettings,
          users: usersResponse.users.filter((user) => user.isActive),
        };
      } catch (error) {
        toast({
          title: t("reports.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    }
  });

  useEffect(() => {
    initializedDraftRef.current = false;
    setDraft(savedDraft ?? createDefaultReportDraft());
  }, [savedDraft]);
  useEffect(() => {
    if (companySettings) {
      setSettings(companySettings);
    }
  }, [companySettings]);
  const activeUsers = useMemo(() => users.filter((user) => user.isActive), [users]);

  const periodOptions = useMemo<ReportOption[]>(() => [
    { value: "custom", label: t("reports.customDates") },
    { value: "this_week", label: t("reports.thisWeek") },
    { value: "this_month", label: t("reports.thisMonth") },
    { value: "this_year", label: t("reports.thisYear") },
    { value: "last_month", label: t("reports.lastMonth") },
  ], [t]);

  const baseFieldOptions = useMemo<ReportOption[]>(() => {
    const options: ReportOption[] = [
      { value: "user", label: t("reports.user") },
      { value: "role", label: t("reports.role") },
      { value: "type", label: t("reports.type") },
    ];

    if (settings.projectsEnabled) {
      options.push({ value: "project", label: t("reports.project") });
    }
    if (settings.tasksEnabled) {
      options.push({ value: "task", label: t("reports.task") });
    }

    options.push(
      { value: "date", label: t("reports.date") },
      { value: "start", label: t("reports.start") },
      { value: "finish", label: t("reports.finish") },
      { value: "duration", label: t("reports.duration") },
      { value: "overtime_state", label: t("reports.overtimeState") },
      { value: "overtime_timeline", label: t("reports.overtimeTimeline") },
      { value: "note", label: t("reports.note") },
      { value: "cost", label: t("reports.cost") },
    );

    return options;
  }, [settings.projectsEnabled, settings.tasksEnabled, t]);

  const customFieldOptions = useMemo(
    () =>
      getCustomFieldsForTarget(settings.customFields, { scope: "time_entry" }).map((field) => ({
        value: `custom:${field.id}`,
        label: getCustomFieldOptionLabel(field),
      })),
    [settings.customFields],
  );

  const allFieldOptions = useMemo(() => [...baseFieldOptions, ...customFieldOptions], [baseFieldOptions, customFieldOptions]);
  const groupingOptions = useMemo<ReportOption[]>(() => {
    const options: ReportOption[] = [
      { value: "", label: t("reports.noGrouping") },
      { value: "user", label: t("reports.user") },
      { value: "role", label: t("reports.role") },
      { value: "type", label: t("reports.type") },
    ];

    if (settings.projectsEnabled) {
      options.push({ value: "project", label: t("reports.project") });
    }
    if (settings.tasksEnabled) {
      options.push({ value: "task", label: t("reports.task") });
    }

    options.push(
      { value: "date", label: t("reports.day") },
      { value: "month", label: t("reports.thisMonth") },
      ...customFieldOptions,
    );

    return options;
  }, [customFieldOptions, settings.projectsEnabled, settings.tasksEnabled, t]);

  const selectedGroups = draft.groupBy.length > 0 ? draft.groupBy : [""];
  const userOptions = useMemo(() => activeUsers.map((user) => ({ value: String(user.id), label: user.fullName })), [activeUsers]);

  useEffect(() => {
    if (!pageResource.data) {
      return;
    }

    const nextSettings = pageResource.data.settings;
    const nextBaseFieldOptions: ReportOption[] = [
      { value: "user", label: t("reports.user") },
      { value: "role", label: t("reports.role") },
      { value: "type", label: t("reports.type") },
      ...(nextSettings.projectsEnabled ? [{ value: "project", label: t("reports.project") }] : []),
      ...(nextSettings.tasksEnabled ? [{ value: "task", label: t("reports.task") }] : []),
      { value: "date", label: t("reports.date") },
      { value: "start", label: t("reports.start") },
      { value: "finish", label: t("reports.finish") },
      { value: "duration", label: t("reports.duration") },
      { value: "overtime_state", label: t("reports.overtimeState") },
      { value: "overtime_timeline", label: t("reports.overtimeTimeline") },
      { value: "note", label: t("reports.note") },
      { value: "cost", label: t("reports.cost") },
    ];
    const nextCustomFieldOptions = getCustomFieldsForTarget(nextSettings.customFields, { scope: "time_entry" }).map((field) => ({
      value: `custom:${field.id}`,
      label: getCustomFieldOptionLabel(field),
    }));
    const allFieldValues = getAllFieldValues(nextBaseFieldOptions, nextCustomFieldOptions);
    setSettings(nextSettings);
    setUsers(pageResource.data.users);
    if (!initializedDraftRef.current) {
      setDraft((current) => {
        const normalized = normalizeReportDraftFields(current, nextSettings);
        return {
          ...current,
          userIds: current.userIds.length > 0
            ? current.userIds.filter((userId) => pageResource.data!.users.some((user) => user.id === userId && user.isActive))
            : pageResource.data!.users.filter((user) => user.isActive).map((user) => user.id),
          columns: savedDraft ? normalized.columns : allFieldValues,
          groupBy: normalized.groupBy,
        };
      });
      initializedDraftRef.current = true;
      return;
    }

    setDraft((current) => {
      const normalized = normalizeReportDraftFields(current, nextSettings);
      return {
        ...current,
        groupBy: normalized.groupBy,
        columns: current.columns.filter((column) => allFieldValues.includes(column)),
        userIds: current.userIds.filter((userId) => pageResource.data!.users.some((user) => user.id === userId && user.isActive)),
      };
    });
  }, [baseFieldOptions, pageResource.data, savedDraft]);

  function setGrouping(index: number, value: string) {
    setDraft((current) => {
      const nextGroupBy = [...current.groupBy];
      if (!value) {
        nextGroupBy.splice(index, 1);
      } else {
        nextGroupBy[index] = value;
      }

      return {
        ...current,
        groupBy: nextGroupBy.filter((item, itemIndex, array) => item && array.indexOf(item) === itemIndex),
      };
    });
  }

  function addGroupingLevel() {
    setDraft((current) => ({
      ...current,
      groupBy: [...current.groupBy, ""],
    }));
  }

  function removeGroupingLevel(index: number) {
    setDraft((current) => ({
      ...current,
      groupBy: current.groupBy.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function handleCreateReport() {
    if (draft.userIds.length === 0) {
      toast({ title: t("reports.selectUserRequired") });
      return;
    }
    if (draft.columns.length === 0) {
      toast({ title: t("reports.selectFieldRequired") });
      return;
    }
    if (draft.endDate < draft.startDate) {
      toast({ title: t("reports.invalidDateRange") });
      return;
    }

    const draftId = searchParams.get("draft") ?? createReportDraftId();
    const normalized = normalizeReportDraftFields(draft, settings);
    saveReportDraft(draftId, {
      ...draft,
      columns: normalized.columns,
      groupBy: normalized.groupBy,
      version: 1,
      savedAt: new Date().toISOString(),
    });
    navigate(`/reports/preview?draft=${draftId}`);
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("reports.title")} description={t("reports.description")} />
          </PageIntro>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
      <FormPanel className="flex flex-col gap-6">
        <FormSection>
          <FormFields>
            <Field label={t("reports.selectTimePeriod")}>
              <FieldCombobox
                label="time period"
                value={draft.periodPreset}
                onValueChange={(value) => {
                  const nextRange =
                    value === "custom"
                      ? { startDate: draft.startDate, endDate: draft.endDate }
                      : applyPeriodPreset(value, settings);
                  setDraft((current) => ({ ...current, periodPreset: value, ...nextRange }));
                }}
                items={periodOptions}
              />
            </Field>
            <Field label={t("reports.startDate")}>
              <DateInput
                value={draft.startDate}
                locale={settings.locale}
                firstDayOfWeek={settings.firstDayOfWeek}
                weekendDays={settings.weekendDays}
                timeZone={settings.timeZone}
                onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", startDate: value }))}
              />
            </Field>
            <Field label={t("reports.endDate")}>
              <DateInput
                value={draft.endDate}
                locale={settings.locale}
                firstDayOfWeek={settings.firstDayOfWeek}
                weekendDays={settings.weekendDays}
                timeZone={settings.timeZone}
                onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", endDate: value }))}
              />
            </Field>
          </FormFields>
        </FormSection>

        <FormSection>
          <Field label={t("reports.users")}>
            <MultiSelectFilter
              value={draft.userIds.map(String)}
              onChange={(values) => setDraft((current) => ({ ...current, userIds: values.map(Number) }))}
              options={userOptions}
              searchPlaceholder={t("reports.search")}
              emptyText={t("reports.noResults")}
              selectAllLabel={t("reports.selectAll", { defaultValue: "Select all" })}
              clearLabel={t("reports.clearSelection", { defaultValue: "Clear selection" })}
            />
          </Field>
        </FormSection>

        <FormSection>
          <Field label={t("reports.userFields")}>
            <MultiSelectFilter
              value={draft.columns}
              onChange={(values) => setDraft((current) => ({ ...current, columns: values }))}
              options={allFieldOptions}
              searchPlaceholder={t("reports.search")}
              emptyText={t("reports.noResults")}
              selectAllLabel={t("reports.selectAll", { defaultValue: "Select all" })}
              clearLabel={t("reports.clearSelection", { defaultValue: "Clear selection" })}
            />
          </Field>
        </FormSection>

        <FormSection>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">{t("reports.grouping")}</p>
            <Button variant="ghost" onClick={addGroupingLevel} type="button">
              {t("reports.addLevel")}
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {selectedGroups.map((groupValue, index) => (
              <div key={`${index}-${groupValue || "empty"}`} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field label={index === 0 ? t("reports.groupBy") : t("reports.thenBy", { index })}>
                    <FieldCombobox
                      label={`grouping ${index + 1}`}
                      value={groupValue}
                      onValueChange={(value) => setGrouping(index, value)}
                      items={groupingOptions.filter((option) => !option.value || option.value === groupValue || !draft.groupBy.includes(option.value))}
                    />
                  </Field>
                </div>
                {draft.groupBy.length > 0 ? (
                  <Button className="sm:self-auto" variant="ghost" onClick={() => removeGroupingLevel(index)} type="button">
                    {t("reports.remove")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <FormFields>
            <Field label={t("reports.totalsOnly")}>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
                <span className="text-sm text-foreground">{t("reports.totalsOnlyLabel")}</span>
                <Switch checked={draft.totalsOnly} onCheckedChange={(checked) => setDraft((current) => ({ ...current, totalsOnly: checked }))} />
              </div>
            </Field>
          </FormFields>
        </FormSection>

        <FormActions>
          <Button onClick={handleCreateReport} type="button">
            {t("reports.createReport")}
          </Button>
        </FormActions>
      </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
