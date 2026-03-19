import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Circle, PencilSimple, Play, Plus, Stop, Trash } from "phosphor-react";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  TimeEntryView,
} from "@shared/types/models";
import {
  diffCalendarDays,
  diffMinutes,
  formatLocalDay,
  getLocalNowSnapshot,
  parseLocalDay,
  toClockTimeValue,
} from "@shared/utils/time";
import { formatMinutes } from "@shared/utils/time";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CustomFieldInput } from "@/components/custom-field-input";
import {
  Field,
  FormPage,
  FormSection,
} from "@/components/form-layout";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Stack } from "@/components/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getEntryStateUi, getEntryTypeLabel } from "@/lib/entry-state-ui";
import { formatCompanyDate, formatCompanyDateRange } from "@/lib/locale-format";
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

const defaultSummary: DashboardSummary = {
  todayMinutes: 0,
  weekMinutes: 0,
  activeEntry: null,
  recentEntries: [],
  contractStats: {
    currentContract: null,
    totalBalanceMinutes: 0,
    today: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
    week: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
    month: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
  },
};

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = startOfDay(date);
  value.setDate(value.getDate() + 1);
  value.setMilliseconds(-1);
  return value;
}

function toTimeInputValue(isoValue: string | null, timeZone?: string) {
  return toClockTimeValue(isoValue, timeZone);
}

function canManageOtherUsers(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function isToday(date: Date, timeZone?: string) {
  return formatLocalDay(date) === getLocalNowSnapshot(new Date(), timeZone).localDay;
}

function parseDayParam(value: string | null) {
  if (!value) return new Date();
  return parseLocalDay(value) ?? new Date();
}

function canBypassDayLimits(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function isDayWithinLimit(day: string, limit: number, timeZone?: string) {
  return diffCalendarDays(getLocalNowSnapshot(new Date(), timeZone).localDay, day) <= limit;
}

function getEntryHeadline(entry: TimeEntryView, getLabel: (entryType: TimeEntryView["entryType"]) => string, timeZone?: string) {
  if (entry.entryType === "work") {
    return `${toTimeInputValue(entry.startTime, timeZone)} - ${toTimeInputValue(entry.endTime, timeZone)}`;
  }

  return getLabel(entry.entryType);
}

function getEntryMeta(entry: TimeEntryView, locale: string) {
  if (entry.entryType === "work") {
    return formatMinutes(entry.durationMinutes);
  }

  return `${formatCompanyDateRange(entry.entryDate, entry.endDate, locale)} • ${entry.effectiveDayCount} day${entry.effectiveDayCount === 1 ? "" : "s"}`;
}

function getRecordEntryCircleClass(entryType: TimeEntryView["entryType"], isActiveWorkEntry: boolean) {
  if (isActiveWorkEntry) {
    return "text-destructive";
  }

  if (entryType === "work") {
    return "text-emerald-500 dark:text-emerald-400";
  }

  if (entryType === "vacation") {
    return "text-sky-500 dark:text-sky-400";
  }

  return "text-rose-500 dark:text-rose-400";
}

function getCustomFieldDisplayValue(field: CompanyCustomField | undefined, rawValue: string | number | boolean) {
  if (!field) {
    return String(rawValue);
  }

  if (field.type === "boolean" && typeof rawValue === "boolean") {
    return rawValue ? "Yes" : "No";
  }

  if (field.type === "select" && typeof rawValue === "string") {
    return field.options.find((option) => option.value === rawValue)?.label ?? rawValue;
  }

  return String(rawValue);
}

function getEntrySupportText(entry: TimeEntryView, fieldsById: Map<string, CompanyCustomField>) {
  const customFields = Object.entries(entry.customFieldValues)
    .map(([key, value]) => {
      const field = fieldsById.get(key);
      return `${field?.label ?? key}: ${getCustomFieldDisplayValue(field, value)}`;
    })
    .join(", ");
  return customFields;
}

function formatBalanceMinutes(totalMinutes: number) {
  const prefix = totalMinutes > 0 ? "+" : totalMinutes < 0 ? "-" : "";
  return `${prefix}${formatMinutes(Math.abs(totalMinutes))}`;
}

function triggerHapticFeedback() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(10);
  }
}

function calculateLiveWorkDurationMinutes(
  startTime: string | null,
  endTime: string | null,
  settings: Pick<CompanySettings, "autoBreakAfterMinutes" | "autoBreakDurationMinutes">,
) {
  const rawMinutes = diffMinutes(startTime ?? "", endTime);
  if (settings.autoBreakAfterMinutes <= 0 || settings.autoBreakDurationMinutes <= 0) {
    return rawMinutes;
  }

  if (rawMinutes < settings.autoBreakAfterMinutes) {
    return rawMinutes;
  }

  return Math.max(0, rawMinutes - settings.autoBreakDurationMinutes);
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { companySession, companyIdentity, isTabletMode } = useAuth();
  const { t } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const getEntryLabel = (entryType: TimeEntryView["entryType"]) => getEntryTypeLabel(entryType, t);
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [entries, setEntries] = useState<TimeEntryView[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(defaultSummary);
  const [statsRange, setStatsRange] = useState<"day" | "week" | "month">("month");
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<TimeEntryView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [tabletPunchOpen, setTabletPunchOpen] = useState(false);
  const [tabletPunchValues, setTabletPunchValues] = useState<Record<string, string | number | boolean>>({});
  const [tabletPunchSubmitting, setTabletPunchSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const canSwitchUser = !isTabletMode && canManageOtherUsers(companyIdentity?.user.role);
  const selectedDate = useMemo(
    () => parseDayParam(searchParams.get("day")),
    [searchParams],
  );
  const selectedUserId = useMemo(() => {
    if (isTabletMode) {
      return companyIdentity?.user.id ?? null;
    }
    const rawValue = searchParams.get("user");
    if (!rawValue) return companyIdentity?.user.id ?? null;
    const parsed = Number(rawValue);
    return Number.isNaN(parsed) ? (companyIdentity?.user.id ?? null) : parsed;
  }, [companyIdentity?.user.id, isTabletMode, searchParams]);

  const effectiveUserId = selectedUserId ?? companyIdentity?.user.id ?? null;
  const availableUsers = useMemo<CompanyUserListItem[]>(
    () =>
      users.length > 0
        ? users
        : companyIdentity
          ? [
              {
                id: companyIdentity.user.id,
                fullName: companyIdentity.user.fullName,
                isActive: true,
              },
            ]
          : [],
    [companyIdentity, users],
  );

  const dayMinutes = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
    [entries],
  );
  const selectedUser = availableUsers.find(
    (user) => user.id === effectiveUserId,
  );
  const selectedUserName =
    selectedUser?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const bypassDayLimits = canBypassDayLimits(companyIdentity?.user.role);
  const selectedDayKey = formatLocalDay(selectedDate);
  const canCreateRecord =
    bypassDayLimits ||
    isDayWithinLimit(selectedDayKey, settings.insertDaysLimit, settings.timeZone);
  const canUseTabletPunch = summary.activeEntry ? true : isToday(selectedDate, settings.timeZone) && canCreateRecord;
  const customFieldsById = useMemo(
    () =>
      new Map(settings.customFields.map((field) => [field.id, field])),
    [settings.customFields],
  );
  const activeContractStats =
    statsRange === "day"
      ? summary.contractStats.today
      : statsRange === "week"
        ? summary.contractStats.week
        : summary.contractStats.month;
  const requiredTabletWorkFields = useMemo(
    () => settings.customFields.filter((field) => field.targets.includes("work") && field.required),
    [settings.customFields]
  );

  function cycleStatsRange() {
    setStatsRange((current) =>
      current === "month" ? "week" : current === "week" ? "day" : "month",
    );
  }

  function updateContext(next: { userId?: number | null; day?: Date }) {
    const params = new URLSearchParams(searchParams);
    const userId = next.userId ?? effectiveUserId;
    const day = next.day ?? selectedDate;

    if (userId) params.set("user", String(userId));
    else params.delete("user");

    params.set("day", formatLocalDay(day));
    setSearchParams(params, { replace: true });
  }

  const dashboardResource = usePageResource<{
    settings: CompanySettings;
    users: CompanyUserListItem[];
    entries: TimeEntryView[];
    summary: DashboardSummary;
  }>({
    enabled: Boolean(companySession) && Boolean(effectiveUserId),
    deps: [canSwitchUser, companySession?.token, effectiveUserId, selectedDayKey, t],
    load: async () => {
      if (!companySession || !effectiveUserId) {
        return {
          settings: defaultSettings,
          users: [],
          entries: [],
          summary: defaultSummary,
        };
      }

      try {
        const [settingsResponse, usersResponse, entriesResponse, dashboardResponse] = await Promise.all([
          api.getSettings(companySession.token),
          canSwitchUser ? api.listUsers(companySession.token) : Promise.resolve({ users: [] }),
          api.listTimeEntries(companySession.token, {
            from: formatLocalDay(startOfDay(selectedDate)),
            to: formatLocalDay(endOfDay(selectedDate)),
            targetUserId: canSwitchUser ? effectiveUserId : undefined,
          }),
          api.getDashboard(companySession.token, canSwitchUser ? effectiveUserId : undefined),
        ]);

        return {
          settings: settingsResponse.settings,
          users: usersResponse.users,
          entries: entriesResponse.entries,
          summary: dashboardResponse.summary,
        };
      } catch (error) {
        toast({
          title: t("dashboard.couldNotLoadRecords"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    }
  });

  useEffect(() => {
    if (!companyIdentity?.user.id) return;
    const needsUser = !searchParams.get("user");
    const needsDay = !searchParams.get("day");
    if (!needsUser && !needsDay) return;

    const params = new URLSearchParams(searchParams);
    if (needsUser) params.set("user", String(companyIdentity.user.id));
    if (needsDay) params.set("day", getLocalNowSnapshot(new Date(), settings.timeZone).localDay);
    setSearchParams(params, { replace: true });
  }, [companyIdentity?.user.id, searchParams, setSearchParams, settings.timeZone]);

  useEffect(() => {
    if (!dashboardResource.data) {
      return;
    }

    setSettings(dashboardResource.data.settings);
    setUsers(dashboardResource.data.users);
    setEntries(dashboardResource.data.entries);
    setSummary(dashboardResource.data.summary);
  }, [dashboardResource.data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function deleteEntry(entryId: number) {
    if (!companySession || !effectiveUserId) return;

    try {
      setDeleteSubmitting(true);
      await api.deleteTimeEntry(companySession.token, {
        entryId,
        targetUserId: canSwitchUser ? effectiveUserId : undefined,
      });
      setPendingDeleteEntry(null);
      toast({ title: t("dashboard.recordDeleted") });
      await dashboardResource.reload();
    } catch (error) {
      toast({
        title: t("dashboard.couldNotDeleteRecord"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function setTabletPunchFieldValue(field: CompanyCustomField, nextValue: string | number | boolean | undefined) {
    setTabletPunchValues((current) => ({
      ...current,
      [field.id]: nextValue ?? ""
    }));
  }

  async function startTabletTimer(customFieldValues: Record<string, string | number | boolean>) {
    if (!companySession) return;
    try {
      setTabletPunchSubmitting(true);
      await api.startTimer(companySession.token, { customFieldValues });
      setTabletPunchOpen(false);
      setTabletPunchValues({});
      toast({ title: t("dashboard.timerStarted") });
      await dashboardResource.reload();
    } catch (error) {
      toast({
        title: t("dashboard.couldNotStartTimer"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setTabletPunchSubmitting(false);
    }
  }

  async function stopTabletTimer() {
    if (!companySession || !summary.activeEntry) return;
    try {
      await api.stopTimer(companySession.token, { entryId: summary.activeEntry.id });
      toast({ title: t("dashboard.timerStopped") });
      await dashboardResource.reload();
    } catch (error) {
      toast({
        title: t("dashboard.couldNotStopTimer"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  function handleTabletPunch() {
    triggerHapticFeedback();
    if (summary.activeEntry) {
      void stopTabletTimer();
      return;
    }

    if (requiredTabletWorkFields.length > 0) {
      setTabletPunchOpen(true);
      return;
    }

    void startTabletTimer({});
  }

  const createRecordHref = `/dashboard/records/create?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
  const dayPickerHref = `/dashboard/day?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
  const userOptions = availableUsers.map((user) => ({
    value: String(user.id),
    label: user.fullName,
  }));
  return (
    <FormPage className="flex h-full min-h-full flex-1 flex-col gap-5">
      <Dialog
        open={tabletPunchOpen}
        onOpenChange={(open) => {
          if (tabletPunchSubmitting) return;
          setTabletPunchOpen(open);
          if (!open) setTabletPunchValues({});
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.requiredWorkFieldsTitle")}</DialogTitle>
            <DialogDescription>{t("dashboard.requiredWorkFieldsDescription")}</DialogDescription>
          </DialogHeader>
          <Stack gap="md">
            {requiredTabletWorkFields.map((field) => (
              <Field key={field.id} label={field.label}>
                <CustomFieldInput
                  field={field}
                  value={tabletPunchValues[field.id]}
                  locale={settings.locale}
                  onValueChange={(value) => setTabletPunchFieldValue(field, value)}
                  booleanLabels={{ yes: t("recordEditor.yes"), no: t("recordEditor.no") }}
                />
              </Field>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTabletPunchOpen(false)} type="button" disabled={tabletPunchSubmitting}>
                {t("recordEditor.cancel")}
              </Button>
              <Button onClick={() => void startTabletTimer(tabletPunchValues)} type="button" disabled={tabletPunchSubmitting}>
                {t("dashboard.startWork")}
              </Button>
            </div>
          </Stack>
        </DialogContent>
      </Dialog>
      <AppConfirmDialog
        open={pendingDeleteEntry !== null}
        onOpenChange={(open) =>
          !open && !deleteSubmitting && setPendingDeleteEntry(null)
        }
        title={t("dashboard.deleteRecord")}
        description={
          pendingDeleteEntry
            ? pendingDeleteEntry.entryType === "work"
              ? t("dashboard.deleteWorkDescription", {
                  value: `${toTimeInputValue(pendingDeleteEntry.startTime)} - ${toTimeInputValue(pendingDeleteEntry.endTime)}`
                })
              : t("dashboard.deleteLeaveDescription", {
                  type: getEntryLabel(pendingDeleteEntry.entryType),
                  date: formatCompanyDate(pendingDeleteEntry.entryDate, settings.locale)
                })
            : undefined
        }
        confirmLabel="Delete"
        destructive
        confirming={deleteSubmitting}
        onConfirm={() =>
          pendingDeleteEntry && void deleteEntry(pendingDeleteEntry.id)
        }
      />
      <PageLoadBoundary
        loading={dashboardResource.isLoading}
        refreshing={dashboardResource.isRefreshing}
        overlayLabel={t("common.loading", { defaultValue: "Loading..." })}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} minHeightClassName="min-h-[28rem]" />}
      >
      <PageLabel
        title={t("dashboard.pageTitle")}
        description={t("dashboard.pageDescription")}
      />
      <Stack gap="lg" className="min-h-full flex-1">
      {canSwitchUser ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <FormSection>
            <Field label={t("dashboard.workingAs")}>
              <Combobox
                value={effectiveUserId ? String(effectiveUserId) : ""}
                onValueChange={(value) =>
                  updateContext({ userId: Number(value) })
                }
                options={userOptions}
                placeholder={t("dashboard.workingAs")}
                searchPlaceholder={t("reports.search")}
                emptyText="No users found."
                searchable
              />
            </Field>
          </FormSection>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <Stack gap="lg">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{selectedUserName}</p>
              {isTabletMode ? (
                <Link
                  to={dayPickerHref}
                  className="text-left text-2xl font-semibold tracking-[-0.04em] text-foreground transition-opacity hover:opacity-70"
                >
                  {selectedDate.toLocaleDateString(settings.locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </Link>
              ) : (
                <Link
                  to={dayPickerHref}
                  className="text-left text-2xl font-semibold tracking-[-0.04em] text-foreground transition-opacity hover:opacity-70"
                >
                  {selectedDate.toLocaleDateString(settings.locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{t("dashboard.recorded", { value: formatMinutes(dayMinutes) })}</span>
                {summary.contractStats.currentContract ? (
                  <span>{t("dashboard.perWeek", { value: summary.contractStats.currentContract.hoursPerWeek.toFixed(2) })}</span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="w-[5.5rem] text-right text-sm text-muted-foreground">
                {new Intl.DateTimeFormat(settings.locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: settings.timeZone,
                }).format(now)}
              </p>
              <Button
                variant={isToday(selectedDate, settings.timeZone) ? "secondary" : "outline"}
                onClick={() => updateContext({ day: parseLocalDay(getLocalNowSnapshot(new Date(), settings.timeZone).localDay) ?? new Date() })}
                type="button"
              >
                {t("dashboard.today")}
              </Button>
            </div>
          </div>

          <Stack gap="sm" className="border-t border-border/70 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-sm font-medium text-foreground">{t("dashboard.balance")}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {t("dashboard.total", { value: formatBalanceMinutes(summary.contractStats.totalBalanceMinutes) })}
                </p>
              </div>
              <Button variant="ghost" onClick={cycleStatsRange} type="button" className="h-8 px-3 text-xs">
                {statsRange === "month" ? t("dashboard.month") : statsRange === "week" ? t("dashboard.week") : t("dashboard.day")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                {t("dashboard.expected", { value: formatMinutes(activeContractStats.expectedMinutes) })}
              </Badge>
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                {t("dashboard.recordedBadge", { value: formatMinutes(activeContractStats.recordedMinutes) })}
              </Badge>
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                {t("dashboard.balanceBadge", { value: formatBalanceMinutes(activeContractStats.balanceMinutes) })}
              </Badge>
            </div>
          </Stack>
        </Stack>
      </div>

      <Stack gap="sm" className="rounded-2xl border border-border bg-card p-5">
        <div>
          <p className="text-sm font-medium text-foreground">{t("dashboard.records")}</p>
        </div>

        <div className="overflow-visible">
          <Stack gap="xs">
            {entries.map((entry) => {
              const canEdit =
                bypassDayLimits ||
                isDayWithinLimit(entry.entryDate, settings.editDaysLimit, settings.timeZone);
              const canDelete = canEdit;
              const editHref = `/dashboard/records/${entry.id}/edit?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
              const supportText = getEntrySupportText(
                entry,
                customFieldsById,
              );
              const isActiveWorkEntry =
                entry.entryType === "work" &&
                summary.activeEntry?.id === entry.id &&
                !entry.endTime;
              const entryHeadline = isActiveWorkEntry
                ? `${toTimeInputValue(entry.startTime, settings.timeZone)} - ${toTimeInputValue(now.toISOString(), settings.timeZone)}`
                : getEntryHeadline(entry, getEntryLabel, settings.timeZone);
              const entryMeta =
                entry.entryType === "work"
                  ? formatMinutes(
                      isActiveWorkEntry
                        ? calculateLiveWorkDurationMinutes(entry.startTime, null, settings)
                        : calculateLiveWorkDurationMinutes(entry.startTime, entry.endTime, settings),
                    )
                  : getEntryMeta(entry, settings.locale);

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                    <span className="flex h-4 w-4 flex-none items-center justify-center self-center tablet:h-[1.125rem] tablet:w-[1.125rem]">
                      <Circle
                        size={14}
                        weight="fill"
                        className={getRecordEntryCircleClass(entry.entryType, isActiveWorkEntry)}
                      />
                    </span>
                    <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium leading-tight text-foreground">
                      {entryHeadline}
                    </div>
                    <span
                      className={
                        isActiveWorkEntry
                          ? "shrink-0 truncate whitespace-nowrap rounded-full bg-destructive px-2 py-1 text-xs font-medium leading-tight text-destructive-foreground"
                          : "shrink-0 truncate whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs font-medium leading-tight text-foreground"
                      }
                    >
                      {entryMeta}
                    </span>
                    {supportText ? (
                      <div className="min-w-0 flex-1 truncate whitespace-nowrap text-sm leading-tight text-muted-foreground">
                        {supportText}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center justify-end gap-1 pl-1">
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        className="h-10 w-10"
                        size="icon"
                        onPointerDown={triggerHapticFeedback}
                        onClick={() => setPendingDeleteEntry(entry)}
                        type="button"
                        aria-label={t("dashboard.deleteRecord")}
                      >
                        <Trash size={16} weight="bold" />
                      </Button>
                    ) : (
                      <Button
                        disabled
                        variant="ghost"
                        className="h-10 w-10"
                        size="icon"
                        type="button"
                        aria-label={t("dashboard.recordLocked")}
                      >
                        <Trash size={16} weight="bold" />
                      </Button>
                    )}
                      {canEdit ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-10 w-10"
                          onPointerDown={triggerHapticFeedback}
                          onClick={() => navigate(editHref)}
                          type="button"
                          aria-label={t("dashboard.editRecord")}
                        >
                            <PencilSimple size={16} weight="bold" />
                        </Button>
                      ) : (
                        <Button
                          disabled
                          className="h-10 w-10"
                          size="icon"
                          variant="ghost"
                          type="button"
                          aria-label={t("dashboard.recordLocked")}
                        >
                          <PencilSimple size={16} weight="bold" />
                        </Button>
                      )}
                  </div>
                </div>
              );
            })}

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("dashboard.noRecords")}
              </p>
            ) : null}
          </Stack>
        </div>
      </Stack>

      <div className="flex min-h-[8rem] flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          {isTabletMode ? (
            <>
              <Button
                className={
                  summary.activeEntry
                    ? "h-20 w-20 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
                    : "h-20 w-20 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
                }
                size="icon"
                type="button"
                disabled={!canUseTabletPunch}
                onClick={handleTabletPunch}
                aria-label={summary.activeEntry ? t("dashboard.stopWork") : t("dashboard.startWork")}
              >
                {summary.activeEntry ? <Stop size={36} weight="fill" /> : <Play size={36} weight="fill" />}
              </Button>
              {canCreateRecord ? (
                <Button
                  asChild
                  variant="ghost"
                  className="h-9 rounded-full px-4 text-xs font-medium"
                  onPointerDown={triggerHapticFeedback}
                >
                  <Link to={createRecordHref}>{t("recordEditor.addEntry")}</Link>
                </Button>
              ) : null}
            </>
          ) : canCreateRecord ? (
            <Button
              asChild
              className="h-20 w-20 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
              size="icon"
              type="button"
              onPointerDown={triggerHapticFeedback}
            >
              <Link to={createRecordHref} aria-label={t("dashboard.addRecord")}>
                <Plus size={36} weight="bold" />
              </Link>
            </Button>
          ) : (
            <Button
              disabled
              className="h-20 w-20 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out"
              size="icon"
              type="button"
              aria-label={t("dashboard.addRecordUnavailable")}
            >
              <Plus size={36} weight="bold" />
            </Button>
          )}
          {!canCreateRecord ? (
            <p className="text-center text-sm text-muted-foreground">
              {t("dashboard.employeesInsertLimit")}
            </p>
          ) : null}
        </div>
      </div>
      </Stack>
      </PageLoadBoundary>
    </FormPage>
  );
}
