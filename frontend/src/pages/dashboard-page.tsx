import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, FirstAidKit, PencilSimple, Play, Plus, SpinnerGap, Stop, Trash, UmbrellaSimple } from "phosphor-react";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  PublicHolidayRecord,
  TimeEntryView,
} from "@shared/types/models";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { evaluateTimeEntryPolicy, getAllowedEntryTypesForDay, getFutureDayDistance, getPastDayDistance } from "@shared/utils/time-entry-policy";
import {
  enumerateLocalDays,
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
import { PageDock } from "@/components/page-dock";
import { PageLoadBoundary } from "@/components/page-load-state";
import { Stack } from "@/components/stack";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getEntryStateUi, getEntryTypeLabel } from "@/lib/entry-state-ui";
import { formatCompanyDate, formatCompanyDateRange } from "@/lib/locale-format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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
  allowRecordsOnHolidays: true,
  allowFutureRecords: false,
  country: "AT",
  tabletIdleTimeoutSeconds: 10,
  autoBreakAfterMinutes: 300,
  autoBreakDurationMinutes: 30,
  customFields: [],
  overtime: createDefaultOvertimeSettings(),
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

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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

function buildRecordEditorHref(userId: number | null, day: Date, entryType?: "vacation") {
  const params = new URLSearchParams();
  if (userId) {
    params.set("user", String(userId));
  }
  params.set("day", formatLocalDay(day));
  if (entryType) {
    params.set("type", entryType);
  }
  return `/dashboard/records/create?${params.toString()}`;
}

function getHolidayDisplayName(holiday: PublicHolidayRecord | undefined) {
  if (!holiday) {
    return null;
  }

  return holiday.localName?.trim() || holiday.name?.trim() || null;
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

function getRecordEntryStatusClass(entryType: TimeEntryView["entryType"], isActiveWorkEntry: boolean) {
  if (isActiveWorkEntry) {
    return "border-emerald-500/25 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  }

  if (entryType === "work") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }

  if (entryType === "vacation") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  }

  return "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400";
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

function resolveCalendarDayState(entries: TimeEntryView[]): "work" | "sick_leave" | "vacation" | "mixed" | null {
  let nextState: "work" | "sick_leave" | "vacation" | "mixed" | null = null;

  for (const entry of entries) {
    if (!nextState || nextState === entry.entryType) {
      nextState = entry.entryType;
      continue;
    }

    return "mixed";
  }

  return nextState;
}

function RecordStatusIcon({
  entryType,
  active,
}: {
  entryType: TimeEntryView["entryType"];
  active: boolean;
}) {
  const Icon = active
    ? SpinnerGap
    : entryType === "work"
      ? Briefcase
      : entryType === "vacation"
        ? UmbrellaSimple
        : FirstAidKit;

  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 flex-none items-center justify-center self-center rounded-md border",
        getRecordEntryStatusClass(entryType, active)
      )}
    >
      <Icon size={14} weight={active ? "bold" : "fill"} className={active ? "animate-spin" : undefined} />
    </span>
  );
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
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<TimeEntryView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [tabletPunchOpen, setTabletPunchOpen] = useState(false);
  const [tabletPunchValues, setTabletPunchValues] = useState<Record<string, string | number | boolean>>({});
  const [tabletPunchSubmitting, setTabletPunchSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));
  const [calendarHolidays, setCalendarHolidays] = useState<PublicHolidayRecord[]>([]);
  const [calendarDayStates, setCalendarDayStates] = useState<Record<string, "work" | "sick_leave" | "vacation" | "mixed">>({});

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
  const selectedDayKey = formatLocalDay(selectedDate);
  const selectedDayPastDistance = getPastDayDistance(selectedDayKey, settings.timeZone);
  const selectedDayFutureDistance = getFutureDayDistance(selectedDayKey, settings.timeZone);
  const todayDay = getLocalNowSnapshot(new Date(), settings.timeZone).localDay;
  const isNowContext = isToday(selectedDate, settings.timeZone);
  const holidayDateSet = useMemo(() => new Set(calendarHolidays.map((holiday) => holiday.date)), [calendarHolidays]);
  const selectedHoliday = useMemo(
    () => calendarHolidays.find((holiday) => holiday.date === selectedDayKey),
    [calendarHolidays, selectedDayKey]
  );
  const selectedDayIsHoliday = holidayDateSet.has(selectedDayKey);
  const allowedEntryTypes = getAllowedEntryTypesForDay({
    role: companyIdentity?.user.role,
    settings,
    day: selectedDayKey,
    todayDay,
    isHoliday: selectedDayIsHoliday,
  });
  const selectedDayWorkPolicy = evaluateTimeEntryPolicy({
    mode: "create",
    role: companyIdentity?.user.role,
    settings,
    entryType: "work",
    startDate: selectedDayKey,
    endDate: selectedDayKey,
    todayDay,
    hasHolidayInRange: selectedDayIsHoliday,
  });
  const selectedDayPolicy = evaluateTimeEntryPolicy({
    mode: "create",
    role: companyIdentity?.user.role,
    settings,
    entryType: allowedEntryTypes.vacation.allowed ? "vacation" : "work",
    startDate: selectedDayKey,
    endDate: selectedDayKey,
    todayDay,
    hasHolidayInRange: selectedDayIsHoliday,
  });
  const selectedDayWorkBlockedByHoliday = !allowedEntryTypes.work.allowed && selectedDayIsHoliday;
  const futureRecordSelected = selectedDayFutureDistance > 0;
  const futureVacationOnly = allowedEntryTypes.onlyVacationAllowed && futureRecordSelected;
  const canCreateRecord = allowedEntryTypes.anyAllowed;
  const canUseTabletPunch = summary.activeEntry
    ? true
    : isNowContext && allowedEntryTypes.work.allowed;
  const createRecordMessage =
    selectedDayPolicy.reason === "insert_limit"
      ? t("dashboard.insertLimitDetailed", {
          limit: settings.insertDaysLimit,
          days: selectedDayPastDistance,
          date: formatCompanyDate(selectedDayKey, settings.locale),
        })
      : futureVacationOnly
      ? t("dashboard.futureVacationOnly", {
          date: formatCompanyDate(selectedDayKey, settings.locale),
          days: selectedDayFutureDistance,
        })
      : selectedDayWorkPolicy.reason === "holiday_work_blocked"
      ? t("dashboard.holidayWorkBlocked", {
          date: formatCompanyDate(selectedDayKey, settings.locale),
          holiday: getHolidayDisplayName(selectedHoliday) ?? formatCompanyDate(selectedDayKey, settings.locale),
        })
      : null;
  const customFieldsById = useMemo(
    () =>
      new Map(settings.customFields.map((field) => [field.id, field])),
    [settings.customFields],
  );
  const requiredTabletWorkFields = useMemo(
    () => settings.customFields.filter((field) => field.targets.includes("work") && field.required),
    [settings.customFields]
  );

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
          api.getDashboard(companySession.token, canSwitchUser ? effectiveUserId : undefined, selectedDayKey),
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

  const calendarResource = usePageResource<{
    holidays: PublicHolidayRecord[];
    dayStates: Record<string, "work" | "sick_leave" | "vacation" | "mixed">;
  }>({
    enabled: Boolean(companySession) && Boolean(effectiveUserId),
    deps: [companySession?.token, effectiveUserId, visibleMonth.getFullYear(), visibleMonth.getMonth(), t],
    load: async () => {
      if (!companySession || !effectiveUserId) {
        return {
          holidays: [],
          dayStates: {},
        };
      }

      const settingsResponse = await api.getSettings(companySession.token);
      const [holidayResponse, entriesResponse] = await Promise.all([
        api.getPublicHolidays(companySession.token, settingsResponse.settings.country, visibleMonth.getFullYear()),
        api.listTimeEntries(companySession.token, {
          from: formatLocalDay(startOfMonth(visibleMonth)),
          to: formatLocalDay(endOfDay(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0))),
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
        }),
      ]);

      const nextStates: Record<string, "work" | "sick_leave" | "vacation" | "mixed"> = {};
      for (const entry of entriesResponse.entries) {
        for (const entryDay of enumerateLocalDays(entry.entryDate, entry.endDate ?? entry.entryDate)) {
          const currentState = nextStates[entryDay];
          nextStates[entryDay] =
            !currentState || currentState === entry.entryType
              ? entry.entryType
              : "mixed";
        }
      }

      return {
        holidays: holidayResponse.holidays,
        dayStates: nextStates,
      };
    },
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

  useEffect(() => {
    setVisibleMonth(startOfMonth(selectedDate));
  }, [selectedDayKey]);

  useEffect(() => {
    if (!calendarResource.data) {
      return;
    }

    setCalendarHolidays(calendarResource.data.holidays);
    setCalendarDayStates(calendarResource.data.dayStates);
  }, [calendarResource.data]);

  useEffect(() => {
    setCalendarDayStates((current) => {
      const nextState = resolveCalendarDayState(entries);
      if (nextState === current[selectedDayKey]) {
        return current;
      }

      const next = { ...current };
      if (nextState) {
        next[selectedDayKey] = nextState;
      } else {
        delete next[selectedDayKey];
      }
      return next;
    });
  }, [entries, selectedDayKey]);

  async function refreshDashboardViews() {
    await Promise.all([dashboardResource.reload(), calendarResource.reload()]);
  }

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
      await refreshDashboardViews();
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
      await refreshDashboardViews();
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
      await refreshDashboardViews();
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

  const createRecordHref = buildRecordEditorHref(effectiveUserId, selectedDate, futureVacationOnly ? "vacation" : undefined);
  const dockShowsPlay = isNowContext && allowedEntryTypes.work.allowed && !summary.activeEntry;
  const dockShowsStop = Boolean(summary.activeEntry);
  const dockUsesPlus = !dockShowsStop && !dockShowsPlay;
  const userOptions = availableUsers.map((user) => ({
    value: String(user.id),
    label: user.fullName,
  }));
  return (
    <FormPage className="min-h-0 flex-none">
      <PageDock>
        <div className="flex min-h-[5rem] flex-col items-center justify-center">
          {dashboardResource.isLoading ? (
            <div className="h-16 w-16 rounded-[999px] border border-border bg-muted/40" />
          ) : isTabletMode ? (
            <>
              {dockShowsStop || dockShowsPlay ? (
                <Button
                  className={
                    summary.activeEntry
                      ? "h-16 w-16 animate-[pulse_1.4s_ease-in-out_infinite] rounded-[999px] bg-destructive text-destructive-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
                      : "h-16 w-16 rounded-[999px] bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
                  }
                  size="icon"
                  type="button"
                  disabled={!canUseTabletPunch}
                  onClick={handleTabletPunch}
                  aria-label={summary.activeEntry ? t("dashboard.stopWork") : t("dashboard.startWork")}
                >
                  {summary.activeEntry ? <Stop size={30} weight="fill" /> : <Play size={30} weight="fill" />}
                </Button>
              ) : canCreateRecord ? (
                <Button
                  asChild
                  className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
                  size="icon"
                  type="button"
                  onPointerDown={triggerHapticFeedback}
                >
                  <Link to={createRecordHref} aria-label={t("dashboard.addRecord")}>
                    <Plus size={30} weight="bold" />
                  </Link>
                </Button>
              ) : (
                <Button
                  disabled
                  className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out"
                  size="icon"
                  type="button"
                  aria-label={t("dashboard.addRecordUnavailable")}
                >
                  <Plus size={30} weight="bold" />
                </Button>
              )}
              {dockShowsPlay && canCreateRecord ? (
                <Button
                  asChild
                  variant="ghost"
                  className="mt-3 h-9 px-4 text-xs font-medium"
                  onPointerDown={triggerHapticFeedback}
                >
                  <Link to={createRecordHref}>{t("recordEditor.addEntry")}</Link>
                </Button>
              ) : null}
            </>
          ) : canCreateRecord ? (
            <Button
              asChild
              className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
              size="icon"
              type="button"
              onPointerDown={triggerHapticFeedback}
            >
              <Link to={createRecordHref} aria-label={t("dashboard.addRecord")}>
                <Plus size={30} weight="bold" />
              </Link>
            </Button>
          ) : (
            <Button
              disabled
              className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out"
              size="icon"
              type="button"
              aria-label={t("dashboard.addRecordUnavailable")}
            >
              <Plus size={30} weight="bold" />
            </Button>
          )}
          {!dashboardResource.isLoading && createRecordMessage ? (
            <p className="mt-3 max-w-[18rem] text-center text-xs leading-5 text-muted-foreground">
              {createRecordMessage}
            </p>
          ) : null}
        </div>
      </PageDock>
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
        className="min-h-0 flex-none"
        loading={dashboardResource.isLoading}
        refreshing={dashboardResource.isRefreshing}
        skeleton={null}
      >
      <Stack gap="lg" className="min-h-full flex-1">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3">
          <FormSection>
            <Field label={t("dashboard.workingAs")}>
              {canSwitchUser ? (
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
              ) : (
                <div className="flex h-10 items-center rounded-md border border-input bg-transparent px-3 text-sm text-foreground">
                  {selectedUserName}
                </div>
              )}
            </Field>
          </FormSection>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-left text-lg font-semibold tracking-[-0.04em] text-foreground">
                {selectedDate.toLocaleDateString(settings.locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              {summary.contractStats.currentContract ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.perWeek", { value: summary.contractStats.currentContract.hoursPerWeek.toFixed(2) })}
                </p>
              ) : null}
            </div>
            <div className="flex items-center">
              <p className="w-[5.25rem] text-right text-xs text-muted-foreground">
                {new Intl.DateTimeFormat(settings.locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: settings.timeZone,
                }).format(now)}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {t("dashboard.expected", { value: formatMinutes(summary.contractStats.today.expectedMinutes) })}
              </p>
              <Button
                variant={isToday(selectedDate, settings.timeZone) ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => updateContext({ day: parseLocalDay(getLocalNowSnapshot(new Date(), settings.timeZone).localDay) ?? new Date() })}
                type="button"
              >
                {t("dashboard.today")}
              </Button>
            </div>
            <Calendar
              selected={selectedDate}
              onSelect={(date) => updateContext({ day: date })}
              locale={settings.locale}
              firstDayOfWeek={settings.firstDayOfWeek}
              holidayDates={calendarHolidays.map((holiday) => holiday.date)}
              dayStates={calendarDayStates}
              onMonthChange={setVisibleMonth}
              compact
              className="rounded-xl border border-border bg-background"
            />
          </div>
          <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
            <p className="text-sm font-medium text-foreground">{t("dashboard.records")}</p>
            <div className="overflow-visible">
              <Stack gap="xs">
            {entries.map((entry) => {
              const canEdit =
                evaluateTimeEntryPolicy({
                  mode: "edit",
                  role: companyIdentity?.user.role,
                  settings,
                  entryType: entry.entryType,
                  startDate: entry.entryDate,
                  endDate: entry.endDate,
                  todayDay,
                  hasHolidayInRange: false,
                }).allowed;
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
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <RecordStatusIcon entryType={entry.entryType} active={isActiveWorkEntry} />
                    <div className="shrink-0 whitespace-nowrap text-sm font-medium leading-tight text-foreground">
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
                  <div className="relative z-10 flex shrink-0 items-center justify-end gap-1 self-center pl-1">
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
          </div>
        </div>
      </div>

      </Stack>
      </PageLoadBoundary>
    </FormPage>
  );
}
