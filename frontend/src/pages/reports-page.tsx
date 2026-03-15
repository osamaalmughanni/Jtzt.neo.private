import { CheckCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CompanySettings, CompanyUserListItem } from "@shared/types/models";
import type { ReportRequestInput } from "@shared/types/api";
import { formatLocalDay } from "@shared/utils/time";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createReportDraftId, loadReportDraft, saveReportDraft } from "@/lib/report-draft-storage";
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

type ReportOption = { value: string; label: string };

function getCustomFieldOptionLabel(field: CompanySettings["customFields"][number]) {
  const cleaned = field.label.trim();
  if (
    cleaned.length > 0 &&
    cleaned !== field.id &&
    !/^field[-_:]/i.test(cleaned) &&
    !/^custom:/i.test(cleaned)
  ) {
    return cleaned;
  }

  return field.id
    .replace(/^field[-_:]*/i, "")
    .replace(/^custom:/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

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

function getMonthRange(date: Date) {
  return {
    startDate: formatLocalDay(new Date(date.getFullYear(), date.getMonth(), 1)),
    endDate: formatLocalDay(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

function getLastMonthRange(date: Date) {
  return getMonthRange(new Date(date.getFullYear(), date.getMonth() - 1, 1));
}

function getYearRange(date: Date) {
  return {
    startDate: formatLocalDay(new Date(date.getFullYear(), 0, 1)),
    endDate: formatLocalDay(new Date(date.getFullYear(), 11, 31)),
  };
}

function getWeekRange(date: Date) {
  const next = new Date(date);
  const weekday = next.getDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  next.setDate(next.getDate() + delta);
  const end = new Date(next);
  end.setDate(end.getDate() + 6);
  return { startDate: formatLocalDay(next), endDate: formatLocalDay(end) };
}

function applyPeriodPreset(periodPreset: string) {
  const today = new Date();
  if (periodPreset === "this_week") return getWeekRange(today);
  if (periodPreset === "this_month") return getMonthRange(today);
  if (periodPreset === "last_month") return getLastMonthRange(today);
  if (periodPreset === "this_year") return getYearRange(today);
  return {
    startDate: formatLocalDay(today),
    endDate: formatLocalDay(today),
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
  const [draft, setDraft] = useState<ReportDraft>(() => savedDraft ?? {
    periodPreset: "this_month",
    ...applyPeriodPreset("this_month"),
    userIds: [],
    columns: [],
    groupBy: [],
    totalsOnly: false,
  });

  useEffect(() => {
    if (!companySession) return;
    void Promise.all([
      api.getSettings(companySession.token),
      api.listUsers(companySession.token),
    ]).then(([settingsResponse, usersResponse]) => {
      const nextCustomFieldOptions = settingsResponse.settings.customFields.map((field) => ({
        value: `custom:${field.id}`,
        label: getCustomFieldOptionLabel(field),
      }));
      const allFieldValues = getAllFieldValues(baseFieldOptions, nextCustomFieldOptions);
      setSettings(settingsResponse.settings);
      setUsers(usersResponse.users);
      setDraft((current) => ({
        ...current,
        userIds: current.userIds.length > 0 ? current.userIds : usersResponse.users.map((user) => user.id),
        columns: savedDraft ? current.columns : allFieldValues,
      }));
    }).catch((error) =>
      toast({
        title: t("reports.loadFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      }),
    );
  }, [companySession, savedDraft, t]);

  const periodOptions: ReportOption[] = [
    { value: "custom", label: t("reports.customDates") },
    { value: "this_week", label: t("reports.thisWeek") },
    { value: "this_month", label: t("reports.thisMonth") },
    { value: "this_year", label: t("reports.thisYear") },
    { value: "last_month", label: t("reports.lastMonth") },
  ];

  const baseFieldOptions: ReportOption[] = [
    { value: "user", label: t("reports.user") },
    { value: "role", label: t("reports.role") },
    { value: "type", label: t("reports.type") },
    { value: "date", label: t("reports.date") },
    { value: "start", label: t("reports.start") },
    { value: "finish", label: t("reports.finish") },
    { value: "duration", label: t("reports.duration") },
    { value: "note", label: t("reports.note") },
    { value: "cost", label: t("reports.cost") },
  ];

  const customFieldOptions = settings.customFields.map((field) => ({
    value: `custom:${field.id}`,
    label: getCustomFieldOptionLabel(field),
  }));

  const allFieldOptions = [...baseFieldOptions, ...customFieldOptions];
  const groupingOptions: ReportOption[] = [
    { value: "", label: t("reports.noGrouping") },
    { value: "user", label: t("reports.user") },
    { value: "role", label: t("reports.role") },
    { value: "type", label: t("reports.type") },
    { value: "date", label: t("reports.day") },
    { value: "month", label: t("reports.thisMonth") },
    ...customFieldOptions,
  ];

  const selectedGroups = draft.groupBy.length > 0 ? draft.groupBy : [""];
  const userOptions = users.map((user) => ({ value: String(user.id), label: user.fullName }));

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
    saveReportDraft(draftId, draft);
    navigate(`/reports/preview?draft=${draftId}`);
  }

  return (
    <FormPage>
      <PageLabel title={t("reports.title")} description={t("reports.description")} />
      <FormPanel className="flex flex-col gap-6">
        <FormSection>
          <FormFields>
            <Field label={t("reports.selectTimePeriod")}>
              <FieldCombobox
                label="time period"
                value={draft.periodPreset}
                onValueChange={(value) => {
                  const nextRange = value === "custom" ? { startDate: draft.startDate, endDate: draft.endDate } : applyPeriodPreset(value);
                  setDraft((current) => ({ ...current, periodPreset: value, ...nextRange }));
                }}
                items={periodOptions}
              />
            </Field>
            <Field label={t("reports.startDate")}>
              <DateInput value={draft.startDate} locale={settings.locale} onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", startDate: value }))} />
            </Field>
            <Field label={t("reports.endDate")}>
              <DateInput value={draft.endDate} locale={settings.locale} onChange={(value) => setDraft((current) => ({ ...current, periodPreset: "custom", endDate: value }))} />
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
    </FormPage>
  );
}
