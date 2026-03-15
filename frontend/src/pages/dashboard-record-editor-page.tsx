import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  PublicHolidayRecord,
  SickLeaveAttachment,
  TimeEntryType,
} from "@shared/types/models";
import {
  combineLocalDayAndTimeToIsoInTimeZone,
  countEffectiveLeaveDays,
  diffCalendarDays,
  formatLocalDay,
  getLocalNowSnapshot,
  toClockTimeValue,
} from "@shared/utils/time";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
};

const entryTypeTabs: Array<{ value: TimeEntryType; label: string }> = [
  { value: "work", label: "Working" },
  { value: "vacation", label: "Vacation" },
  { value: "sick_leave", label: "Sick leave" },
];

function getEntryTypeTabClassName(entryType: TimeEntryType) {
  if (entryType === "work") {
    return "rounded-xl border border-transparent px-3 py-2 transition-colors data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-emerald-400/30 dark:data-[state=active]:bg-emerald-400/15";
  }

  if (entryType === "vacation") {
    return "rounded-xl border border-transparent px-3 py-2 transition-colors data-[state=active]:border-sky-500/30 data-[state=active]:bg-sky-500/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-sky-400/30 dark:data-[state=active]:bg-sky-400/15";
  }

  return "rounded-xl border border-transparent px-3 py-2 transition-colors data-[state=active]:border-rose-500/30 data-[state=active]:bg-rose-500/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-rose-400/30 dark:data-[state=active]:bg-rose-400/15";
}

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

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = dataUrl;
  });

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process image");
  context.drawImage(image, 0, 0, width, height);
  const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  if (compressedDataUrl.length > 8_000_000) {
    throw new Error("Compressed image is still too large");
  }

  return {
    fileName: file.name.replace(/\.[^.]+$/, ".jpg"),
    mimeType: "image/jpeg",
    dataUrl: compressedDataUrl
  };
}

async function prepareSickLeaveAttachment(file: File): Promise<SickLeaveAttachment> {
  if (file.type.startsWith("image/")) {
    return compressImageFile(file);
  }

  if (file.size > 6 * 1024 * 1024) {
    throw new Error("PDF must be 6 MB or smaller");
  }

  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl: await readFileAsDataUrl(file)
  };
}

interface DashboardRecordEditorPageProps {
  mode: "create" | "edit";
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
  const [sickLeaveAttachment, setSickLeaveAttachment] = useState<SickLeaveAttachment | null>(null);
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
        setSickLeaveAttachment(response.entry.sickLeaveAttachment);
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

    if (entryType !== "sick_leave") {
      setSickLeaveAttachment(null);
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
              sickLeaveAttachment: null,
              customFieldValues,
            }
          : {
              entryType,
              startDate,
              endDate: resolvedEndDate,
              startTime: null,
              endTime: null,
              notes,
              sickLeaveAttachment: entryType === "sick_leave" ? sickLeaveAttachment : null,
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

  async function handleAttachmentChange(file: File | null) {
    if (!file) return;
    try {
      const nextAttachment = await prepareSickLeaveAttachment(file);
      setSickLeaveAttachment(nextAttachment);
    } catch (error) {
      toast({
        title: t("recordEditor.couldNotPrepareAttachment"),
        description: error instanceof Error ? error.message : "Request failed",
      });
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

function setCustomFieldValue(field: CompanyCustomField, nextValue: string) {
    setCustomFieldValues((current) => ({
      ...current,
      [field.id]:
        field.type === "number"
          ? nextValue === ""
            ? ""
            : Number(nextValue)
          : field.type === "boolean"
            ? nextValue === "true"
            : nextValue,
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
      <PageBackAction to={backTo} label={t("recordEditor.backToOverview")} />
      <PageLabel title={mode === "create" ? t("recordEditor.addTitle") : t("recordEditor.editTitle")} description={t("recordEditor.description", { name: selectedUserName })} />
      <FormPanel>
        {loading ? <p className="text-sm text-muted-foreground">{t("recordEditor.loading")}</p> : null}
        {dayLimitError ? (
          <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {dayLimitError}
          </div>
        ) : null}

        <FormSection>
          <Tabs value={entryType} onValueChange={(value) => setEntryType(value as TimeEntryType)}>
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
              {entryTypeTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={getEntryTypeTabClassName(tab.value)}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </FormSection>

        <FormSection>
          <FormFields>
            <Field label={usesDateRange ? t("recordEditor.fromDate") : t("recordEditor.fromDate")}>
              <DateInput value={startDate} locale={settings.locale} onChange={setStartDate} />
            </Field>
            {usesDateRange ? (
              <Field label={t("recordEditor.toDate")}>
                <DateInput value={endDate} locale={settings.locale} onChange={setEndDate} />
              </Field>
            ) : null}
            {entryType === "work" ? (
              <>
                <Field label={t("recordEditor.startTime")}>
                  <TimeInput
                    value={startTime}
                    onChange={setStartTime}
                    onNowClick={setStartTime}
                    timeZone={settings.timeZone}
                  />
                </Field>
                <Field label={t("recordEditor.endTime")}>
                  <TimeInput
                    value={endTime}
                    onChange={setEndTime}
                    onNowClick={setEndTime}
                    timeZone={settings.timeZone}
                  />
                </Field>
              </>
            ) : null}
            {activeCustomFields.map((field) => (
              <Field key={field.id} label={field.label}>
                {field.type === "boolean" ? (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    value={String(customFieldValues[field.id] ?? "")}
                    onChange={(event) => setCustomFieldValue(field, event.target.value)}
                  >
                    <option value="">{field.required ? t("recordEditor.selectYesOrNo") : t("recordEditor.optional")}</option>
                    <option value="true">{t("recordEditor.yes")}</option>
                    <option value="false">{t("recordEditor.no")}</option>
                  </select>
                ) : field.type === "select" ? (
                  <FieldCombobox
                    label={field.label}
                    value={typeof customFieldValues[field.id] === "string" ? String(customFieldValues[field.id]) : ""}
                    onValueChange={(value) => setCustomFieldValue(field, value)}
                    items={field.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                ) : field.type === "date" ? (
                  <DateInput
                    value={typeof customFieldValues[field.id] === "string" ? String(customFieldValues[field.id]) : ""}
                    locale={settings.locale}
                    onChange={(value) => setCustomFieldValue(field, value)}
                  />
                ) : (
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    type={field.type === "number" ? "number" : "text"}
                    placeholder={field.placeholder ?? field.label}
                    value={String(customFieldValues[field.id] ?? "")}
                    onChange={(event) => setCustomFieldValue(field, event.target.value)}
                  />
                )}
              </Field>
            ))}
            {entryType === "sick_leave" ? (
              <Field label={t("recordEditor.document")}>
                <div className="flex flex-col gap-2">
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"
                    type="file"
                    accept="application/pdf,image/*"
                    capture="environment"
                    onChange={(event) => void handleAttachmentChange(event.target.files?.[0] ?? null)}
                  />
                  {sickLeaveAttachment ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{sickLeaveAttachment.fileName}</p>
                        <p className="text-xs text-muted-foreground">{sickLeaveAttachment.mimeType}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button asChild variant="ghost" type="button">
                          <a href={sickLeaveAttachment.dataUrl} download={sickLeaveAttachment.fileName}>
                            {t("recordEditor.open")}
                          </a>
                        </Button>
                        <Button variant="ghost" onClick={() => setSickLeaveAttachment(null)} type="button">
                          {t("recordEditor.remove")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </Field>
            ) : null}
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
    </FormPage>
  );
}
