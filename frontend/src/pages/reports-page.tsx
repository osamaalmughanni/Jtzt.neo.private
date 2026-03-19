import { CheckCheck, X } from "lucide-react";
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
import { getCustomFieldOptionLabel, normalizeReportDraftFields } from "@/lib/report-fields";
import { createReportDraftId, loadReportDraft, saveReportDraft } from "@/lib/report-draft-storage";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: "en-GB",
  timeZone: "Europe/Vienna",
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
  overtime: createDefaultOvertimeSettings(),
};

type ReportOption = { value: string; label: string };

type ReportDraft = ReportRequestInput & {
  periodPreset: string;
};

function InlineMultiSelector({
  value,
  onChange,
  options,
  search,
  onSearchChange,
  searchPlaceholder,
  emptyText,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: ReportOption[];
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const filteredOptions = options.filter((option) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return true;
    return option.label.toLowerCase().includes(normalizedSearch);
  });

  function toggle(nextValue: string) {
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }

    onChange([...value, nextValue]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input className="flex-1" placeholder={searchPlaceholder} value={search} onChange={(event) => onSearchChange(event.target.value)} />
        <Button
          aria-label="Select all"
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => onChange(options.map((option) => option.value))}
        >
          <CheckCheck className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Clear selection"
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => onChange([])}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-border">
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          filteredOptions.map((option) => {
            const selected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${selected ? "bg-muted text-foreground" : "bg-background text-foreground"}`}
                onClick={() => toggle(option.value)}
              >
                <span className="truncate text-foreground">{option.label}</span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-foreground" : "bg-border"}`} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

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

export function ReportsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const savedDraft = loadReportDraft(searchParams.get("draft"));
  const initializedDraftRef = useRef(false);
  const [draft, setDraft] = useState<ReportDraft>(() => savedDraft ?? {
    periodPreset: "this_month",
    ...applyPeriodPreset("this_month", defaultSettings),
    userIds: [],
    columns: [],
    groupBy: [],
    totalsOnly: false,
  });
  const pageResource = usePageResource<{ settings: CompanySettings; users: CompanyUserListItem[] }>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, savedDraft, t],
    load: async () => {
      if (!companySession) {
        return { settings: defaultSettings, users: [] };
      }

      try {
        const [settingsResponse, usersResponse] = await Promise.all([
          api.getSettings(companySession.token),
          api.listUsers(companySession.token),
        ]);
        return {
          settings: settingsResponse.settings,
          users: usersResponse.users,
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

  const periodOptions = useMemo<ReportOption[]>(() => [
    { value: "custom", label: t("reports.customDates") },
    { value: "this_week", label: t("reports.thisWeek") },
    { value: "this_month", label: t("reports.thisMonth") },
    { value: "this_year", label: t("reports.thisYear") },
    { value: "last_month", label: t("reports.lastMonth") },
  ], [t]);

  const baseFieldOptions = useMemo<ReportOption[]>(() => [
    { value: "user", label: t("reports.user") },
    { value: "role", label: t("reports.role") },
    { value: "type", label: t("reports.type") },
    { value: "date", label: t("reports.date") },
    { value: "start", label: t("reports.start") },
    { value: "finish", label: t("reports.finish") },
    { value: "duration", label: t("reports.duration") },
    { value: "note", label: t("reports.note") },
    { value: "cost", label: t("reports.cost") },
  ], [t]);

  const customFieldOptions = useMemo(
    () =>
      settings.customFields.map((field) => ({
        value: `custom:${field.id}`,
        label: getCustomFieldOptionLabel(field),
      })),
    [settings.customFields],
  );

  const allFieldOptions = useMemo(() => [...baseFieldOptions, ...customFieldOptions], [baseFieldOptions, customFieldOptions]);
  const groupingOptions = useMemo<ReportOption[]>(() => [
    { value: "", label: t("reports.noGrouping") },
    { value: "user", label: t("reports.user") },
    { value: "role", label: t("reports.role") },
    { value: "type", label: t("reports.type") },
    { value: "date", label: t("reports.day") },
    { value: "month", label: t("reports.thisMonth") },
    ...customFieldOptions,
  ], [customFieldOptions, t]);

  const selectedGroups = draft.groupBy.length > 0 ? draft.groupBy : [""];
  const userOptions = useMemo(() => users.map((user) => ({ value: String(user.id), label: user.fullName })), [users]);

  useEffect(() => {
    if (!pageResource.data) {
      return;
    }

    const nextCustomFieldOptions = pageResource.data.settings.customFields.map((field) => ({
      value: `custom:${field.id}`,
      label: getCustomFieldOptionLabel(field),
    }));
    const allFieldValues = getAllFieldValues(baseFieldOptions, nextCustomFieldOptions);
    setSettings(pageResource.data.settings);
    setUsers(pageResource.data.users);
    if (!initializedDraftRef.current) {
      setDraft((current) => {
        const normalized = normalizeReportDraftFields(current, pageResource.data!.settings);
        return {
          ...current,
          userIds: current.userIds.length > 0 ? current.userIds : pageResource.data!.users.map((user) => user.id),
          columns: savedDraft ? normalized.columns : allFieldValues,
          groupBy: normalized.groupBy,
        };
      });
      initializedDraftRef.current = true;
      return;
    }

    setDraft((current) => {
      const normalized = normalizeReportDraftFields(current, pageResource.data!.settings);
      return {
        ...current,
        groupBy: normalized.groupBy,
        columns: current.columns.filter((column) => allFieldValues.includes(column)),
        userIds: current.userIds.filter((userId) => pageResource.data!.users.some((user) => user.id === userId)),
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
                timeZone={settings.timeZone}
                onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", startDate: value }))}
              />
            </Field>
            <Field label={t("reports.endDate")}>
              <DateInput
                value={draft.endDate}
                locale={settings.locale}
                timeZone={settings.timeZone}
                onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", endDate: value }))}
              />
            </Field>
          </FormFields>
        </FormSection>

        <FormSection>
          <Field label={t("reports.users")}>
            <InlineMultiSelector
              value={draft.userIds.map(String)}
              onChange={(values) => setDraft((current) => ({ ...current, userIds: values.map(Number) }))}
              options={userOptions}
              search={userSearch}
              onSearchChange={setUserSearch}
              searchPlaceholder={t("reports.search")}
              emptyText={t("reports.noResults")}
            />
          </Field>
        </FormSection>

        <FormSection>
          <Field label={t("reports.userFields")}>
            <InlineMultiSelector
              value={draft.columns}
              onChange={(values) => setDraft((current) => ({ ...current, columns: values }))}
              options={allFieldOptions}
              search={fieldSearch}
              onSearchChange={setFieldSearch}
              searchPlaceholder={t("reports.search")}
              emptyText={t("reports.noResults")}
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
