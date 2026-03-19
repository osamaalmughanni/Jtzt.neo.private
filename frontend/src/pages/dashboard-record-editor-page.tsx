import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  PublicHolidayRecord,
  TimeEntryType,
} from "@shared/types/models";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import {
  combineLocalDayAndTimeToIsoInTimeZone,
  countEffectiveLeaveDays,
  diffCalendarDays,
  formatLocalDay,
  getLocalNowSnapshot,
  toClockTimeValue,
} from "@shared/utils/time";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CustomFieldInput } from "@/components/custom-field-input";
import { EntryTypeTabs } from "@/components/entry-type-tabs";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { TimeInput } from "@/components/ui/time-input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

function canManageOtherUsers(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function canBypassDayLimits(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function isDayWithinLimit(day: string, limit: number, timeZone?: string) {
  return diffCalendarDays(getLocalNowSnapshot(new Date(), timeZone).localDay, day) <= limit;
}

function parseDayParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return getLocalNowSnapshot(new Date(), defaultSettings.timeZone).localDay;
  }
  return value;
}

function enumerateYears(startDate: string, endDate: string) {
  const years = new Set<number>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));
  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }
  return Array.from(years);
}

interface DashboardRecordEditorPageProps {
  mode: "create" | "edit";
}

function EntryScheduleFields({
  locale,
  timeZone,
  entryType,
  startDate,
  endDate,
  startTime,
  endTime,
  onStartDateChange,
  onEndDateChange,
  onStartTimeChange,
  onEndTimeChange,
  fromDateLabel,
  toDateLabel,
  startTimeLabel,
  endTimeLabel,
}: {
  locale: string;
  timeZone: string;
  entryType: TimeEntryType;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  fromDateLabel: string;
  toDateLabel: string;
  startTimeLabel: string;
  endTimeLabel: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Field className="flex-1" label={fromDateLabel}>
          <DateInput value={startDate} locale={locale} onChange={onStartDateChange} />
        </Field>
        <Field className="flex-1" label={toDateLabel}>
          <DateInput value={endDate} locale={locale} onChange={onEndDateChange} />
        </Field>
      </div>
      {entryType === "work" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field className="flex-1" label={startTimeLabel}>
            <TimeInput
              value={startTime}
              onChange={onStartTimeChange}
              onNowClick={onStartTimeChange}
              timeZone={timeZone}
              locale={locale}
            />
          </Field>
          <Field className="flex-1" label={endTimeLabel}>
            <TimeInput
              value={endTime}
              onChange={onEndTimeChange}
              onNowClick={onEndTimeChange}
              timeZone={timeZone}
              locale={locale}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}

export function DashboardRecordEditorPage({ mode }: DashboardRecordEditorPageProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { entryId } = useParams();
  const { companySession, companyIdentity, isTabletMode } = useAuth();
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [entryType, setEntryType] = useState<TimeEntryType>("work");
  const [startDate, setStartDate] = useState(parseDayParam(searchParams.get("day")));
  const [endDate, setEndDate] = useState(parseDayParam(searchParams.get("day")));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [holidays, setHolidays] = useState<PublicHolidayRecord[]>([]);

  const canSwitchUser = !isTabletMode && canManageOtherUsers(companyIdentity?.user.role);
  const bypassDayLimits = canBypassDayLimits(companyIdentity?.user.role);
  const selectedDay = parseDayParam(searchParams.get("day"));
  const effectiveUserId =
    canSwitchUser
      ? Number(searchParams.get("user") ?? companyIdentity?.user.id ?? 0) || companyIdentity?.user.id || 0
      : companyIdentity?.user.id || 0;
  const backTo = `/dashboard?user=${effectiveUserId}&day=${selectedDay}`;
  const usesDateRange = true;
  const activeCustomFields = useMemo(
    () => settings.customFields.filter((field) => field.targets.includes(entryType)),
    [entryType, settings.customFields],
  );
  const entryTypeTabs: Array<{ value: TimeEntryType; label: string }> = [
    { value: "work", label: t("recordEditor.working") },
    { value: "vacation", label: t("recordEditor.vacation") },
    { value: "sick_leave", label: t("recordEditor.sickLeave") },
  ];

  const selectedUserName =
    users.find((user) => user.id === effectiveUserId)?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const resolvedEndDate = endDate;
  const holidaySet = useMemo(() => new Set(holidays.map((holiday) => holiday.date)), [holidays]);
  const leaveMetrics = useMemo(
    () => countEffectiveLeaveDays(startDate, resolvedEndDate, holidaySet),
    [holidaySet, resolvedEndDate, startDate],
  );
  const insertLocked = !bypassDayLimits && mode === "create" && !isDayWithinLimit(startDate, settings.insertDaysLimit, settings.timeZone);
  const editLocked = !bypassDayLimits && mode === "edit" && !isDayWithinLimit(startDate, settings.editDaysLimit, settings.timeZone);
  const dayLimitError = insertLocked
    ? t("recordEditor.employeesInsertLimit")
    : editLocked
      ? t("recordEditor.employeesEditLimit")
      : null;

  useEffect(() => {
    if (!companySession) return;

    void api.getSettings(companySession.token).then((response) => setSettings(response.settings)).catch(() => undefined);

    if (!canSwitchUser) return;
    void api.listUsers(companySession.token).then((response) => setUsers(response.users)).catch(() => undefined);
  }, [canSwitchUser, companySession]);

  useEffect(() => {
    if (!companySession || settings.country.length !== 2) return;
    const nextYears = enumerateYears(startDate, resolvedEndDate);
    void Promise.all(nextYears.map((year) => api.getPublicHolidays(companySession.token, settings.country, year)))
      .then((responses) => setHolidays(responses.flatMap((response) => response.holidays)))
      .catch(() => setHolidays([]));
  }, [companySession, resolvedEndDate, settings.country, startDate]);

  useEffect(() => {
    if (mode !== "edit" || !companySession || !entryId || !effectiveUserId) return;

    setLoading(true);
    void api
      .getTimeEntry(companySession.token, Number(entryId), canSwitchUser ? effectiveUserId : undefined)
      .then((response) => {
        setEntryType(response.entry.entryType);
        setStartDate(response.entry.entryDate);
        setEndDate(response.entry.endDate ?? response.entry.entryDate);
        setStartTime(toClockTimeValue(response.entry.startTime, settings.timeZone));
        setEndTime(toClockTimeValue(response.entry.endTime, settings.timeZone));
        setNotes(response.entry.notes);
        setCustomFieldValues(response.entry.customFieldValues);
      })
      .catch((error) =>
        toast({
        title: t("recordEditor.couldNotLoadRecord"),
          description: error instanceof Error ? error.message : "Request failed",
        }),
      )
      .finally(() => setLoading(false));
  }, [canSwitchUser, companySession, effectiveUserId, entryId, mode, settings.timeZone]);

  useEffect(() => {
    if (entryType !== "work") {
      setStartTime("");
      setEndTime("");
    }
  }, [entryType]);

  async function handleSave() {
    if (!companySession || !effectiveUserId) return;

    try {
      if (resolvedEndDate < startDate) throw new Error(t("recordEditor.endDateAfterStart"));
      if (dayLimitError) throw new Error(dayLimitError);
      if (entryType === "work") {
        if (!startTime) throw new Error(t("recordEditor.startTimeRequired"));
        if (!endTime) throw new Error(t("recordEditor.endTimeRequired"));
      }
      for (const field of activeCustomFields) {
        const value = customFieldValues[field.id];
        if (field.required && (value === undefined || value === "")) {
          throw new Error(`${field.label} is required`);
        }
      }

      const workStartTime = entryType === "work" ? combineLocalDayAndTimeToIsoInTimeZone(startDate, startTime, settings.timeZone) : null;
      const workEndTime = entryType === "work" ? combineLocalDayAndTimeToIsoInTimeZone(resolvedEndDate, endTime, settings.timeZone) : null;
      if (entryType === "work" && (!workStartTime || !workEndTime)) {
        throw new Error("Invalid time value");
      }

      const payload =
        entryType === "work"
          ? {
              entryType,
              startDate,
              endDate: resolvedEndDate,
              startTime: workStartTime,
              endTime: workEndTime,
              notes,
              customFieldValues,
            }
          : {
              entryType,
              startDate,
              endDate: resolvedEndDate,
              startTime: null,
              endTime: null,
              notes,
              customFieldValues,
            };

      setSaving(true);

      if (mode === "create") {
        await api.createManualTimeEntry(companySession.token, {
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
          ...payload,
        });
        toast({ title: t("recordEditor.entryAdded") });
      } else {
        await api.updateTimeEntry(companySession.token, {
          entryId: Number(entryId),
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
          ...payload,
        });
        toast({ title: t("recordEditor.entrySaved") });
      }

      if (entryType !== "work" && (leaveMetrics.excludedHolidayCount > 0 || leaveMetrics.excludedWeekendCount > 0)) {
        toast({
          title: t("recordEditor.thisRangeStaysValid", {
            effective: leaveMetrics.effectiveDayCount,
            holidays: leaveMetrics.excludedHolidayCount,
            holidaySuffix: leaveMetrics.excludedHolidayCount === 1 ? "" : "s",
            weekends: leaveMetrics.excludedWeekendCount,
            weekendSuffix: leaveMetrics.excludedWeekendCount === 1 ? "" : "s"
          })
        });
      }

      navigate(backTo);
    } catch (error) {
      toast({
        title: mode === "create" ? t("recordEditor.couldNotAddEntry") : t("recordEditor.couldNotSaveEntry"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !entryId || !effectiveUserId) return;

    try {
      setDeleting(true);
      await api.deleteTimeEntry(companySession.token, {
        entryId: Number(entryId),
        targetUserId: canSwitchUser ? effectiveUserId : undefined,
      });
      setConfirmDeleteOpen(false);
      toast({ title: t("recordEditor.recordDeleted") });
      navigate(backTo);
    } catch (error) {
      toast({
        title: t("recordEditor.couldNotDeleteRecord"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  function setCustomFieldValue(field: CompanyCustomField, nextValue: string | number | boolean | undefined) {
    setCustomFieldValues((current) => ({
      ...current,
      [field.id]: nextValue ?? "",
    }));
  }

  return (
    <FormPage>
      <AppConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => !deleting && setConfirmDeleteOpen(open)}
        title={t("recordEditor.deleteRecord")}
        description={mode === "edit" ? t("recordEditor.deleteDescription") : undefined}
        confirmLabel={t("recordEditor.delete")}
        destructive
        confirming={deleting}
        onConfirm={() => void handleDelete()}
      />
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to={backTo} label={t("recordEditor.backToOverview")} />
            <PageLabel
              title={mode === "create" ? t("recordEditor.addTitle") : t("recordEditor.editTitle")}
              description={t("recordEditor.description", { name: selectedUserName })}
            />
          </>
        }
        loading={loading}
        skeleton={<PageLoadingState />}
      >
        <FormPanel>
          {dayLimitError ? (
            <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              {dayLimitError}
            </div>
          ) : null}

          <FormSection>
            <EntryTypeTabs value={entryType} onValueChange={setEntryType} items={entryTypeTabs} />
          </FormSection>

          <FormSection>
            <FormFields>
              <EntryScheduleFields
                locale={settings.locale}
                timeZone={settings.timeZone}
                entryType={entryType}
                startDate={startDate}
                endDate={usesDateRange ? endDate : startDate}
                startTime={startTime}
                endTime={endTime}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                fromDateLabel={t("recordEditor.fromDate")}
                toDateLabel={t("recordEditor.toDate")}
                startTimeLabel={t("recordEditor.startTime")}
                endTimeLabel={t("recordEditor.endTime")}
              />
              {activeCustomFields.map((field) => (
                <Field key={field.id} label={field.label}>
                  <CustomFieldInput
                    field={field}
                    value={customFieldValues[field.id]}
                    locale={settings.locale}
                    onValueChange={(value) => setCustomFieldValue(field, value)}
                    booleanLabels={{ yes: t("recordEditor.yes"), no: t("recordEditor.no") }}
                  />
                </Field>
              ))}
              <Field label={t("recordEditor.notes")}>
                <Textarea
                  placeholder={
                    entryType === "work"
                      ? t("recordEditor.workNotesPlaceholder")
                      : entryType === "vacation"
                        ? t("recordEditor.vacationNotesPlaceholder")
                        : t("recordEditor.absenceNotesPlaceholder")
                  }
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </FormFields>
          </FormSection>

          <FormActions>
            <div className="flex flex-1 justify-start">
              {mode === "edit" ? (
                <Button variant="ghost" disabled={deleting || saving} onClick={() => setConfirmDeleteOpen(true)} type="button">
                  {deleting ? t("recordEditor.deleting") : t("recordEditor.delete")}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => navigate(backTo)} type="button">
                {t("recordEditor.cancel")}
              </Button>
              <Button disabled={saving || loading || deleting || Boolean(dayLimitError)} onClick={() => void handleSave()} type="button">
                {saving ? t("recordEditor.saving") : mode === "create" ? t("recordEditor.addEntry") : t("recordEditor.save")}
              </Button>
            </div>
          </FormActions>
        </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
