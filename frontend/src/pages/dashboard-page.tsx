import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, CalendarBlank, ClockCounterClockwise, FirstAidKit, PencilSimple, Play, Plus, Prohibit, SpinnerGap, Stop, Trash, UmbrellaSimple } from "phosphor-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  PublicHolidayRecord,
  TimeEntryView,
} from "@shared/types/models";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { evaluateTimeEntryPolicy, getAllowedEntryTypesForDay, getFutureDayDistance, getPastDayDistance } from "@shared/utils/time-entry-policy";
import {
  enumerateLocalDays,
  diffMinutes,
  formatLocalDay,
  getLocalNowSnapshot,
  isWeekendDay,
  parseLocalDay,
  toClockTimeValue,
} from "@shared/utils/time";
import { buildCustomFieldValueLabelLookup, getCustomFieldsForTarget, resolveCustomFieldValueLabel } from "@shared/utils/custom-fields";
import { formatMinutes } from "@shared/utils/time";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CustomFieldField } from "@/components/custom-field-field";
import { DockActionButton, DockActionStack } from "@/components/dock-action-stack";
import {
  Field,
  FormFields,
  FormPage,
  FormSection,
} from "@/components/form-layout";
import { PageDock } from "@/components/page-dock";
import { PageBackAction } from "@/components/page-back-action";
import { PageLoadBoundary } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Stack } from "@/components/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Combobox } from "@/components/ui/combobox";
import { HintStack } from "@/components/ui/hint-stack";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompanySettings } from "@/lib/company-settings";
import { useAppHeaderState } from "@/components/app-header-state";
import { getEntryStateUi, getEntryTypeLabel } from "@/lib/entry-state-ui";
import { formatCompanyDate } from "@/lib/locale-format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";

type DashboardSnapshot = {
  entries: TimeEntryView[];
  summary: DashboardSummary;
};

type CalendarSnapshot = {
  holidays: PublicHolidayRecord[];
  dayStates: Record<string, "work" | "sick_leave" | "vacation" | "time_off_in_lieu" | "mixed">;
};

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

const defaultSummary: DashboardSummary = {
  todayMinutes: 0,
  weekMinutes: 0,
  activeEntry: null,
  recentEntries: [],
  contractStats: {
    currentContract: null,
    totalBalanceMinutes: 0,
    week: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
    month: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
    vacation: { entitledDays: 0, usedDays: 0, availableDays: 0 },
    timeOffInLieu: { earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 },
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

function addMonths(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function getCalendarMonthKey(date: Date, country: string, userId: number | null, token?: string) {
  return [
    token ?? "none",
    userId ?? "none",
    country,
    date.getFullYear(),
    date.getMonth(),
  ].join("|");
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

function groupAssignments<T extends { projectId: number }>(rows: T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.projectId) ?? [];
    current.push(row);
    grouped.set(row.projectId, current);
  }
  return grouped;
}

function isToday(date: Date, timeZone?: string) {
  return formatLocalDay(date) === getLocalNowSnapshot(new Date(), timeZone).localDay;
}

function parseDayParam(value: string | null) {
  if (!value) return new Date();
  return parseLocalDay(value) ?? new Date();
}

function buildRecordEditorHref(userId: number | null, day: Date, entryType?: "vacation" | "time_off_in_lieu") {
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

function getEntryHeadline(entry: TimeEntryView, getLabel: (entryType: TimeEntryView["entryType"]) => string) {
  return getLabel(entry.entryType);
}

function formatDayCount(value: number) {
  const normalized = Math.max(0, value);
  const hasFraction = Math.abs(normalized % 1) > 0;
  const formatted = normalized.toFixed(hasFraction ? 1 : 0);
  const suffix = Math.abs(normalized - 1) < 0.01 ? "day" : "days";
  return `${formatted} ${suffix}`;
}

function getRecordEntryStatusClass(entryType: TimeEntryView["entryType"], isActiveWorkEntry: boolean) {
  if (isActiveWorkEntry) {
    return "border-emerald-500/25 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  }
  return "";
}

function getEntrySupportText(
  entry: TimeEntryView,
  fieldsById: Map<string, CompanyCustomField>,
  customFieldValueLabels: Map<string, string>,
) {
  const customFields = Object.entries(entry.customFieldValues)
    .map(([key, value]) => {
      const field = fieldsById.get(key);
      const resolved = resolveCustomFieldValueLabel(field, value, customFieldValueLabels);
      return `${field?.label ?? key}: ${resolved ?? String(value)}`;
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

function RecordStatusIcon({
  entryType,
  active,
  className,
}: {
  entryType: TimeEntryView["entryType"];
  active: boolean;
  className: string;
}) {
  const Icon = active
    ? SpinnerGap
    : entryType === "work"
      ? Briefcase
      : entryType === "vacation"
        ? UmbrellaSimple
        : entryType === "time_off_in_lieu"
          ? ClockCounterClockwise
        : FirstAidKit;

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={cn(
        "h-8 w-8 p-0 text-muted-foreground pointer-events-none",
        active ? getRecordEntryStatusClass(entryType, active) : className,
      )}
      onClick={(event) => event.preventDefault()}
      tabIndex={-1}
      aria-hidden="true"
    >
      <Icon size={14} weight={active ? "bold" : "fill"} className={active ? "animate-spin" : undefined} />
    </Button>
  );
}

function EmptyRecordIcon({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground/80",
        className,
      )}
    >
      <Prohibit size={14} weight="bold" />
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { companySession, companyIdentity, isTabletMode } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const { setHomeAction } = useAppHeaderState();
  const { t } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const getEntryLabel = (entryType: TimeEntryView["entryType"]) => getEntryTypeLabel(entryType, t);
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [entries, setEntries] = useState<TimeEntryView[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(defaultSummary);
  const [projectData, setProjectData] = useState<ProjectTaskManagementResponse | null>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<TimeEntryView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [tabletPunchSetupOpen, setTabletPunchSetupOpen] = useState(false);
  const [tabletPunchValues, setTabletPunchValues] = useState<Record<string, string | number | boolean>>({});
  const [tabletPunchProjectId, setTabletPunchProjectId] = useState("");
  const [tabletPunchTaskId, setTabletPunchTaskId] = useState("");
  const [tabletPunchSubmitting, setTabletPunchSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => parseDayParam(searchParams.get("day")));
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => parseDayParam(searchParams.get("day")));
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const dashboardCacheRef = useRef(new Map<string, DashboardSnapshot>());
  const dashboardRequestIdRef = useRef(0);
  const dashboardHasLoadedRef = useRef(false);
  const calendarMonthCacheRef = useRef(new Map<string, CalendarSnapshot>());
  const calendarMonthRequestRef = useRef(new Map<string, Promise<CalendarSnapshot>>());
  const calendarMonthGenerationRef = useRef(0);

  const canSwitchUser = !isTabletMode && canManageOtherUsers(companyIdentity?.user.role);
  const isWorkspaceMode = companySession?.actorType === "workspace";
  const selectedDayKey = formatLocalDay(selectedDate);
  const selectedUserId = useMemo(() => {
    if (isTabletMode) {
      return companyIdentity?.user.id ?? null;
    }
    const rawValue = searchParams.get("user");
    if (!rawValue) return isWorkspaceMode ? null : companyIdentity?.user.id ?? null;
    const parsed = Number(rawValue);
    return Number.isNaN(parsed) ? (isWorkspaceMode ? null : companyIdentity?.user.id ?? null) : parsed;
  }, [companyIdentity?.user.id, isTabletMode, isWorkspaceMode, searchParams]);

  useEffect(() => {
    if (companySettings) {
      setSettings(companySettings);
    }
  }, [companySettings]);

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
                role: companyIdentity.user.role,
              },
            ]
          : [],
    [companyIdentity, users],
  );
  const effectiveUserId = selectedUserId ?? (isWorkspaceMode ? availableUsers[0]?.id ?? null : companyIdentity?.user.id ?? null);

  const dayMinutes = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
    [entries],
  );
  const selectedUser = availableUsers.find(
    (user) => user.id === effectiveUserId,
  );
  const selectedUserName =
    selectedUser?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const previousSelectedDayKeyRef = useRef(selectedDayKey);
  const todayDay = getLocalNowSnapshot(new Date(), settings.timeZone).localDay;
  const selectedDayPastDistance = getPastDayDistance(selectedDayKey, todayDay);
  const selectedDayFutureDistance = getFutureDayDistance(selectedDayKey, todayDay);
  const isNowContext = isToday(selectedDate, settings.timeZone);
  const loadCalendarMonthSnapshot = useCallback(async (targetMonth: Date) => {
    if (!companySession || !effectiveUserId) {
      return {
        holidays: [],
        dayStates: {},
      } satisfies CalendarSnapshot;
    }

    const normalizedMonth = startOfMonth(targetMonth);
    const cacheKey = getCalendarMonthKey(normalizedMonth, settings.country, effectiveUserId, companySession.token);
    const generation = calendarMonthGenerationRef.current;
    const cached = calendarMonthCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = calendarMonthRequestRef.current.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      const [holidayResponse, entriesResponse] = await Promise.all([
        api.getPublicHolidays(companySession.token, settings.country, normalizedMonth.getFullYear()),
        api.listTimeEntries(companySession.token, {
          from: formatLocalDay(startOfMonth(normalizedMonth)),
          to: formatLocalDay(endOfDay(new Date(normalizedMonth.getFullYear(), normalizedMonth.getMonth() + 1, 0))),
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
        }),
      ]);

      const nextStates: CalendarSnapshot["dayStates"] = {};
      for (const entry of entriesResponse.entries) {
        for (const entryDay of enumerateLocalDays(entry.entryDate, entry.endDate ?? entry.entryDate)) {
          const currentState = nextStates[entryDay];
          nextStates[entryDay] =
            !currentState || currentState === entry.entryType
              ? entry.entryType
              : "mixed";
        }
      }

      const snapshot: CalendarSnapshot = {
        holidays: holidayResponse.holidays,
        dayStates: nextStates,
      };

      if (calendarMonthGenerationRef.current === generation) {
        calendarMonthCacheRef.current.set(cacheKey, snapshot);
      }
      calendarMonthRequestRef.current.delete(cacheKey);
      return snapshot;
    })().catch((error) => {
      calendarMonthRequestRef.current.delete(cacheKey);
      throw error;
    });

    calendarMonthRequestRef.current.set(cacheKey, request);
    return request;
  }, [canSwitchUser, companySession, effectiveUserId, settings.country]);

  const calendarResource = usePageResource<CalendarSnapshot>({
    enabled: Boolean(companySession) && Boolean(effectiveUserId),
    deps: [companySession?.token, effectiveUserId, visibleMonth.getFullYear(), visibleMonth.getMonth(), t],
    load: () => loadCalendarMonthSnapshot(visibleMonth),
    minPendingMs: 0,
  });
  useEffect(() => {
    if (!companySession || !effectiveUserId) {
      return;
    }

    const currentMonth = startOfMonth(visibleMonth);
    void loadCalendarMonthSnapshot(currentMonth);
    void loadCalendarMonthSnapshot(addMonths(currentMonth, -1));
    void loadCalendarMonthSnapshot(addMonths(currentMonth, 1));
  }, [companySession, effectiveUserId, loadCalendarMonthSnapshot, visibleMonth]);

  const calendarHolidays = calendarResource.data?.holidays ?? [];
  const holidayDateSet = useMemo(() => new Set(calendarHolidays.map((holiday) => holiday.date)), [calendarHolidays]);
  const selectedDayIsWeekend = isWeekendDay(selectedDayKey, settings.weekendDays);
  const selectedHoliday = useMemo(
    () => calendarHolidays.find((holiday) => holiday.date === selectedDayKey),
    [calendarHolidays, selectedDayKey]
  );
  const selectedDayIsHoliday = holidayDateSet.has(selectedDayKey);
  const calendarHolidayDates = useMemo(
    () => calendarResource.data?.holidays.map((holiday) => holiday.date) ?? [],
    [calendarResource.data?.holidays],
  );
  const calendarDayStates = useMemo(
    () => calendarResource.data?.dayStates ?? {},
    [calendarResource.data?.dayStates],
  );
  const allowedEntryTypes = getAllowedEntryTypesForDay({
    role: companyIdentity?.user.role,
    settings,
    day: selectedDayKey,
    todayDay,
    isHoliday: selectedDayIsHoliday,
    isWeekend: selectedDayIsWeekend,
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
    hasWeekendInRange: selectedDayIsWeekend,
  });
  const selectedDayPolicy = evaluateTimeEntryPolicy({
    mode: "create",
    role: companyIdentity?.user.role,
    settings,
    entryType: allowedEntryTypes.vacation.allowed ? "vacation" : allowedEntryTypes.timeOffInLieu.allowed ? "time_off_in_lieu" : "work",
    startDate: selectedDayKey,
    endDate: selectedDayKey,
    todayDay,
    hasHolidayInRange: selectedDayIsHoliday,
    hasWeekendInRange: selectedDayIsWeekend,
  });
  const selectedDayWorkBlockedByHoliday = !allowedEntryTypes.work.allowed && selectedDayIsHoliday;
  const futureRecordSelected = selectedDayFutureDistance > 0;
  const futurePlannedLeaveOnly = allowedEntryTypes.onlyPlannedLeaveAllowed && futureRecordSelected;
  const selectedDayHasWorkEntry = entries.some((entry) => entry.entryType === "work");
  const selectedDayHasLeaveEntry = entries.some((entry) => entry.entryType !== "work");
  const workEntryAllowed = allowedEntryTypes.work.allowed && !selectedDayHasLeaveEntry;
  const vacationAllowed = allowedEntryTypes.vacation.allowed && summary.contractStats.vacation.availableDays > 0;
  const timeOffAllowed = allowedEntryTypes.timeOffInLieu.allowed && summary.contractStats.timeOffInLieu.availableMinutes > 0;
  const leaveEntryAllowed = !selectedDayHasWorkEntry && !selectedDayHasLeaveEntry && (allowedEntryTypes.sickLeave.allowed || vacationAllowed || timeOffAllowed);
  const canCreateRecord = workEntryAllowed || leaveEntryAllowed;
  const singleRecordBlocked = settings.allowOneRecordPerDay && entries.length > 0;
  const canUseTabletPunch = summary.activeEntry
    ? true
    : isNowContext && workEntryAllowed;
  const singleRecordMessage = singleRecordBlocked ? t("dashboard.oneRecordPerDay") : null;
  const canAddRecordButton = canCreateRecord && !singleRecordBlocked;
  const createRecordMessage =
    selectedDayPolicy.reason === "insert_limit"
      ? t("dashboard.insertLimitDetailed", {
          limit: settings.insertDaysLimit,
          days: selectedDayPastDistance,
          date: formatCompanyDate(selectedDayKey, settings.locale),
        })
      : futurePlannedLeaveOnly
      ? t("dashboard.futureVacationOnly", {
          date: formatCompanyDate(selectedDayKey, settings.locale),
          days: selectedDayFutureDistance,
        })
      : selectedDayWorkPolicy.reason === "holiday_work_blocked"
      ? t("dashboard.holidayWorkBlocked", {
          date: formatCompanyDate(selectedDayKey, settings.locale),
          holiday: getHolidayDisplayName(selectedHoliday) ?? formatCompanyDate(selectedDayKey, settings.locale),
        })
      : selectedDayWorkPolicy.reason === "weekend_work_blocked"
      ? t("dashboard.weekendWorkBlocked", {
          date: formatCompanyDate(selectedDayKey, settings.locale),
        })
      : selectedDayHasWorkEntry
      ? t("dashboard.workDayAlreadyBooked")
      : selectedDayHasLeaveEntry
      ? t("recordEditor.leaveTypeAlreadyBooked")
      : null;
  const recordDockMessages = useMemo(
    () => [singleRecordMessage, createRecordMessage].filter((value): value is string => Boolean(value)),
    [createRecordMessage, singleRecordMessage],
  );
  const customFieldsById = useMemo(
    () =>
      new Map(settings.customFields.map((field) => [field.id, field])),
    [settings.customFields],
  );
  const customFieldValueLabels = useMemo(
    () => buildCustomFieldValueLabelLookup(settings.customFields),
    [settings.customFields],
  );
  const projectUsersByProject = useMemo(
    () => groupAssignments(projectData?.projectUsers ?? []),
    [projectData?.projectUsers],
  );
  const projectTasksByProject = useMemo(
    () => groupAssignments(projectData?.projectTasks ?? []),
    [projectData?.projectTasks],
  );
  const availableProjects = useMemo(() => {
    const userId = companyIdentity?.user.id ?? 0;
    return (projectData?.projects ?? []).filter((project) => {
      if (project.allowAllUsers) {
        return true;
      }

      const assignments = projectUsersByProject.get(project.id) ?? [];
      return assignments.some((assignment) => assignment.userId === userId);
    });
  }, [companyIdentity?.user.id, projectData?.projects, projectUsersByProject]);
  const selectedTabletProjectId = tabletPunchProjectId ? Number(tabletPunchProjectId) : null;
  const selectedTabletProject = availableProjects.find((project) => project.id === selectedTabletProjectId) ?? null;
  const availableTabletTasks = useMemo(() => {
    if (!settings.tasksEnabled) {
      return [];
    }

    if (!selectedTabletProject) {
      return (projectData?.tasks ?? []).filter((task) => task.isActive);
    }

    if (selectedTabletProject.allowAllTasks) {
      return (projectData?.tasks ?? []).filter((task) => task.isActive);
    }

    const taskAssignments = projectTasksByProject.get(selectedTabletProject.id) ?? [];
    const allowedTaskIds = new Set(taskAssignments.map((assignment) => assignment.taskId));
    return (projectData?.tasks ?? []).filter((task) => task.isActive && allowedTaskIds.has(task.id));
  }, [projectData?.tasks, projectTasksByProject, selectedTabletProject, settings.tasksEnabled]);
  const tabletProjectOptions = useMemo(
    () => availableProjects.map((project) => ({
      value: String(project.id),
      label: project.name,
    })),
    [availableProjects],
  );
  const tabletTaskOptions = useMemo(
    () => availableTabletTasks.map((task) => ({
      value: String(task.id),
      label: task.title,
    })),
    [availableTabletTasks],
  );
  useEffect(() => {
    if (tabletPunchProjectId && !availableProjects.some((project) => project.id === Number(tabletPunchProjectId))) {
      setTabletPunchProjectId("");
      setTabletPunchTaskId("");
    }
    if (tabletPunchTaskId && !availableTabletTasks.some((task) => task.id === Number(tabletPunchTaskId))) {
      setTabletPunchTaskId("");
    }
  }, [availableProjects, availableTabletTasks, tabletPunchProjectId, tabletPunchTaskId]);
  const requiredTabletWorkFields = useMemo(
    () => getCustomFieldsForTarget(settings.customFields, { scope: "time_entry", entryType: "work" }).filter((field) => field.required),
    [settings.customFields]
  );

  const searchParamsRef = useRef(searchParams);
  const effectiveUserIdRef = useRef<number | null>(effectiveUserId);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);
  useEffect(() => {
    effectiveUserIdRef.current = effectiveUserId;
  }, [effectiveUserId]);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  useEffect(() => {
    if (!datePickerOpen) {
      setDraftDate(selectedDate);
    }
  }, [datePickerOpen, selectedDate]);
  useEffect(() => {
    const nextSelectedDate = parseDayParam(searchParams.get("day"));
    if (formatLocalDay(nextSelectedDate) !== formatLocalDay(selectedDate)) {
      setSelectedDate(nextSelectedDate);
    }
  }, [searchParams, selectedDate]);
  const updateContext = useCallback((next: { userId?: number | null; day?: Date }) => {
    const params = new URLSearchParams(searchParamsRef.current);
    const userId = next.userId ?? effectiveUserIdRef.current;
    const day = next.day ?? selectedDateRef.current;

    if (next.day) {
      setSelectedDate(day);
    }

    if (userId) params.set("user", String(userId));
    else params.delete("user");

    params.set("day", formatLocalDay(day));
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);
  const openDatePicker = useCallback((day?: Date) => {
    const nextDate = day ?? selectedDateRef.current;
    setDraftDate(nextDate);
    setVisibleMonth(startOfMonth(nextDate));
    setDatePickerOpen(true);
  }, [setVisibleMonth]);
  const closeDatePicker = useCallback(() => {
    setDatePickerOpen(false);
    setDraftDate(selectedDateRef.current);
  }, []);
  const goToToday = useCallback(() => {
    const todayDate = parseLocalDay(getLocalNowSnapshot(new Date(), settings.timeZone).localDay) ?? new Date();
    updateContext({ day: todayDate });
  }, [settings.timeZone, updateContext]);
  useEffect(() => {
    if (!companySession || !canSwitchUser) {
      setUsers([]);
      return;
    }

    let cancelled = false;
    void api.listActiveUsers(companySession.token)
      .then((response) => {
        if (!cancelled) {
          setUsers(response.users);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canSwitchUser, companySession]);

  const loadDashboardSnapshot = useCallback(async (targetDay: Date, targetUserId: number | null) => {
    if (!companySession) {
      return {
        entries: [],
        summary: defaultSummary,
      } satisfies DashboardSnapshot;
    }

    const [entriesResponse, dashboardResponse] = await Promise.all([
      api.listTimeEntries(companySession.token, {
        from: formatLocalDay(startOfDay(targetDay)),
        to: formatLocalDay(endOfDay(targetDay)),
        targetUserId: targetUserId ?? undefined,
      }),
      api.getDashboard(companySession.token, targetUserId ?? undefined, formatLocalDay(targetDay)),
    ]);

    return {
      entries: entriesResponse.entries,
      summary: dashboardResponse.summary,
    };
  }, [companySession]);

  const prefetchAdjacentDashboardSnapshots = useCallback((targetDay: Date, targetUserId: number | null) => {
    if (!companySession) {
      return;
    }

    const adjacentDays = [
      new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate() - 1),
      new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate() + 1),
    ];

    for (const day of adjacentDays) {
      const cacheKey = `${targetUserId ?? "none"}|${formatLocalDay(day)}`;
      if (dashboardCacheRef.current.has(cacheKey)) {
        continue;
      }

      void loadDashboardSnapshot(day, targetUserId)
        .then((snapshot) => {
          dashboardCacheRef.current.set(cacheKey, snapshot);
        })
        .catch(() => {
          // Ignore prefetch failures; the active path will report real errors.
        });
    }
  }, [companySession, loadDashboardSnapshot]);

  useEffect(() => {
    if (!companySession) {
      setEntries([]);
      setSummary(defaultSummary);
      setDashboardLoading(false);
      dashboardHasLoadedRef.current = false;
      return;
    }

    const requestId = dashboardRequestIdRef.current + 1;
    dashboardRequestIdRef.current = requestId;
    const resolvedUserId =
      canSwitchUser
        ? selectedUserId ?? users[0]?.id ?? null
        : companyIdentity?.user.id ?? null;
    const cacheKey = `${resolvedUserId ?? "none"}|${selectedDayKey}`;
    const cached = dashboardCacheRef.current.get(cacheKey);

    if (cached) {
      setEntries(cached.entries);
      setSummary(cached.summary);
      setDashboardLoading(false);
      dashboardHasLoadedRef.current = true;
    } else if (!dashboardHasLoadedRef.current) {
      setDashboardLoading(true);
    } else {
      setDashboardLoading(false);
    }

    void loadDashboardSnapshot(selectedDate, resolvedUserId)
      .then((snapshot) => {
        if (dashboardRequestIdRef.current !== requestId) {
          return;
        }

        dashboardCacheRef.current.set(cacheKey, snapshot);
        setEntries(snapshot.entries);
        setSummary(snapshot.summary);
        dashboardHasLoadedRef.current = true;
        setDashboardLoading(false);
        prefetchAdjacentDashboardSnapshots(selectedDate, resolvedUserId);
      })
      .catch((error) => {
        if (dashboardRequestIdRef.current !== requestId) {
          return;
        }

        toast({
          title: t("dashboard.couldNotLoadRecords"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        dashboardHasLoadedRef.current = true;
        setDashboardLoading(false);
      });
  }, [canSwitchUser, companyIdentity?.user.id, companySession, loadDashboardSnapshot, prefetchAdjacentDashboardSnapshots, selectedDate, selectedDayKey, selectedUserId, t, users]);

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
    if (!companySession || (!settings.projectsEnabled && !settings.tasksEnabled)) {
      setProjectData(null);
      return;
    }

    void api.listProjectData(companySession.token, true)
      .then((response) => setProjectData(response))
      .catch(() => setProjectData(null));
  }, [companySession, settings.projectsEnabled, settings.tasksEnabled]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (previousSelectedDayKeyRef.current === selectedDayKey) {
      return;
    }

    previousSelectedDayKeyRef.current = selectedDayKey;
    const nextVisibleMonth = startOfMonth(selectedDate);
    setVisibleMonth((current) =>
      current.getFullYear() === nextVisibleMonth.getFullYear() &&
      current.getMonth() === nextVisibleMonth.getMonth()
        ? current
        : nextVisibleMonth,
    );
  }, [selectedDate, selectedDayKey]);

  async function refreshDashboardViews() {
    const resolvedUserId =
      canSwitchUser
        ? selectedUserId ?? users[0]?.id ?? null
        : companyIdentity?.user.id ?? null;
    const cacheKey = `${resolvedUserId ?? "none"}|${selectedDayKey}`;
    const snapshot = await loadDashboardSnapshot(selectedDate, resolvedUserId);
    dashboardCacheRef.current.set(cacheKey, snapshot);
    setEntries(snapshot.entries);
    setSummary(snapshot.summary);
    dashboardHasLoadedRef.current = true;
    setDashboardLoading(false);
    prefetchAdjacentDashboardSnapshots(selectedDate, resolvedUserId);
    calendarMonthGenerationRef.current += 1;
    calendarMonthCacheRef.current.clear();
    calendarMonthRequestRef.current.clear();
    await calendarResource.reload();
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

  async function startTabletTimer(input: {
    customFieldValues: Record<string, string | number | boolean>;
    projectId?: number | null;
    taskId?: number | null;
  }) {
    if (!companySession) return;
    try {
      setTabletPunchSubmitting(true);
      await api.startTimer(companySession.token, {
        customFieldValues: input.customFieldValues,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
      });
      setTabletPunchSetupOpen(false);
      setTabletPunchValues({});
      setTabletPunchProjectId("");
      setTabletPunchTaskId("");
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

    if (requiredTabletWorkFields.length > 0 || settings.projectsEnabled || settings.tasksEnabled) {
      setTabletPunchSetupOpen(true);
      return;
    }

    void startTabletTimer({ customFieldValues: {} });
  }

  const createRecordHref = buildRecordEditorHref(
    effectiveUserId,
    selectedDate,
    futurePlannedLeaveOnly ? (vacationAllowed ? "vacation" : timeOffAllowed ? "time_off_in_lieu" : undefined) : undefined,
  );
  const dockShowsPlay = isNowContext && workEntryAllowed && !summary.activeEntry;
  const dockShowsStop = Boolean(summary.activeEntry);
  const dockUsesPlus = !dockShowsStop && !dockShowsPlay;
  const dockButtonMode = summary.activeEntry ? "stop" : "play";
  const userOptions = availableUsers.map((user) => ({
    value: String(user.id),
    label: user.fullName,
  }));
  const tabletPunchProjectReady = !settings.projectsEnabled || tabletPunchProjectId.trim().length > 0;
  const tabletPunchTaskReady = !settings.tasksEnabled || tabletPunchTaskId.trim().length > 0;
  const tabletPunchCustomFieldsReady = requiredTabletWorkFields.every((field) => {
    const currentValue = tabletPunchValues[field.id];
    if (field.type === "boolean") {
      return typeof currentValue === "boolean";
    }

    return typeof currentValue === "string"
      ? currentValue.trim().length > 0
      : typeof currentValue === "number";
  });
  const canStartTabletPunch = canUseTabletPunch && tabletPunchProjectReady && tabletPunchTaskReady && tabletPunchCustomFieldsReady;
  const tabletSetupDockKey = [
    "tablet-setup",
    tabletPunchSetupOpen ? "1" : "0",
    tabletPunchSubmitting ? "1" : "0",
    tabletPunchProjectId,
    tabletPunchTaskId,
    canStartTabletPunch ? "1" : "0",
    JSON.stringify(tabletPunchValues),
  ].join("|");
  const dashboardDockKey = useMemo(
    () =>
      [
        "dashboard-dock",
        dashboardLoading ? "1" : "0",
        isTabletMode ? "1" : "0",
        summary.activeEntry?.id ?? "none",
        dockShowsStop ? "1" : "0",
        dockShowsPlay ? "1" : "0",
        canAddRecordButton ? "1" : "0",
        canUseTabletPunch ? "1" : "0",
        createRecordHref,
        createRecordMessage ?? "",
        singleRecordMessage ?? "",
      ].join("|"),
    [
      canAddRecordButton,
      canUseTabletPunch,
      createRecordHref,
      createRecordMessage,
      dashboardLoading,
      dockShowsPlay,
      dockShowsStop,
      isTabletMode,
      singleRecordMessage,
      summary.activeEntry?.id,
    ],
  );

  useEffect(() => {
    if (datePickerOpen) {
      setHomeAction({
        key: "dashboard-home-calendar-close",
        label: t("common.close"),
        onClick: closeDatePicker,
      });
      return () => setHomeAction(null);
    }

    if (tabletPunchSetupOpen) {
      setHomeAction({
        key: "dashboard-home-tablet-close",
        label: t("common.close"),
        onClick: () => setTabletPunchSetupOpen(false),
      });
      return () => setHomeAction(null);
    }

    setHomeAction({
      key: "dashboard-home-today",
      label: "Today",
      onClick: goToToday,
    });
    return () => setHomeAction(null);
  }, [closeDatePicker, datePickerOpen, goToToday, setHomeAction, tabletPunchSetupOpen, t]);

  if (isTabletMode && tabletPunchSetupOpen) {
    return (
      <FormPage className="min-h-0 flex-none">
        <PageBackAction onClick={() => setTabletPunchSetupOpen(false)} label={t("common.close")} />
        <FormSection>
          <PageLabel
            title={t("dashboard.startWork")}
            description={t("dashboard.startWorkDescription", { defaultValue: "Fill the required fields to start a timer." })}
          />
          <FormFields>
            {settings.projectsEnabled ? (
              <Field label={t("recordEditor.project", { defaultValue: "Project" })}>
                <Combobox
                  value={tabletPunchProjectId}
                  onValueChange={(value) => {
                    setTabletPunchProjectId(value);
                    setTabletPunchTaskId("");
                  }}
                  options={tabletProjectOptions}
                  placeholder={t("dashboard.selectProject", { defaultValue: "Select project" })}
                  searchPlaceholder={t("dashboard.searchProject", { defaultValue: "Search project" })}
                  emptyText={t("dashboard.noProjects", { defaultValue: "No projects found" })}
                  searchable
                />
              </Field>
            ) : null}
            {settings.tasksEnabled ? (
              <Field label={t("recordEditor.task", { defaultValue: "Task" })}>
                <Combobox
                  value={tabletPunchTaskId}
                  onValueChange={setTabletPunchTaskId}
                  options={tabletTaskOptions}
                  placeholder={t("recordEditor.taskPlaceholder", { defaultValue: "Select task" })}
                  searchPlaceholder={t("recordEditor.taskSearchPlaceholder", { defaultValue: "Search task" })}
                  emptyText={t("recordEditor.noTasks", { defaultValue: "No tasks found" })}
                  searchable
                />
              </Field>
            ) : null}
            {requiredTabletWorkFields.map((field) => (
              <CustomFieldField
                key={field.id}
                field={field}
                value={tabletPunchValues[field.id]}
                locale={settings.locale}
                onValueChange={(value) => setTabletPunchFieldValue(field, value)}
                booleanLabels={{ yes: t("settings.enabled"), no: t("settings.disabled") }}
              />
            ))}
          </FormFields>
        </FormSection>
        <PageDock cacheKey={tabletSetupDockKey}>
          <DockActionStack
            primary={(
              <Button
                className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-[background-color,color,transform,opacity] duration-200 ease-out hover:opacity-95 active:scale-95"
                size="icon"
                type="button"
                disabled={!canStartTabletPunch || tabletPunchSubmitting}
                onClick={() => void startTabletTimer({
                  customFieldValues: tabletPunchValues,
                  projectId: tabletPunchProjectId ? Number(tabletPunchProjectId) : null,
                  taskId: tabletPunchTaskId ? Number(tabletPunchTaskId) : null,
                })}
                aria-label={t("dashboard.startWork")}
              >
                <span className="relative block h-8 w-8">
                  <Play
                    size={30}
                    weight="fill"
                    className="absolute inset-0 m-auto opacity-100 transition-opacity duration-300 ease-out"
                  />
                </span>
              </Button>
            )}
            secondary={
              <DockActionButton
                onClick={() => {
                  setTabletPunchSetupOpen(false);
                  setTabletPunchValues({});
                  setTabletPunchProjectId("");
                  setTabletPunchTaskId("");
                }}
                type="button"
                disabled={tabletPunchSubmitting}
              >
                {t("common.cancel")}
              </DockActionButton>
            }
          />
        </PageDock>
      </FormPage>
    );
  }

  if (datePickerOpen) {
    return (
      <motion.div
        key="calendar-picker"
        className="min-h-0 flex-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        style={{ willChange: "opacity" }}
      >
        <FormPage className="min-h-0 flex-none">
          <PageBackAction onClick={closeDatePicker} label={t("common.close")} />
          <FormSection>
            <PageLabel
              title={t("calendar.selectDate")}
              description={t("calendar.selectDateHint")}
            />
            <Calendar
              selected={draftDate}
              month={visibleMonth}
              onSelect={(date) => {
                setDraftDate(date);
                setVisibleMonth(startOfMonth(date));
                updateContext({ day: date });
                setDatePickerOpen(false);
              }}
              locale={settings.locale}
              firstDayOfWeek={settings.firstDayOfWeek}
              weekendDays={settings.weekendDays}
              holidayDates={calendarHolidayDates}
              dayStates={calendarDayStates}
              onMonthChange={setVisibleMonth}
              compact
            />
          </FormSection>
          <PageDock cacheKey={`calendar-picker|${formatLocalDay(draftDate)}|${visibleMonth.getFullYear()}|${visibleMonth.getMonth()}`}>
            <DockActionStack
              message={(
                <p className="text-center text-xs leading-5 text-muted-foreground">
                  {formatCompanyDate(formatLocalDay(draftDate), settings.locale)}
                </p>
              )}
            />
          </PageDock>
        </FormPage>
      </motion.div>
    );
  }

  return (
    <FormPage className="min-h-0 flex-none">
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
        loading={dashboardLoading}
        refreshing={false}
        skeleton={null}
      >
      <Stack gap="lg" className="min-h-full flex-1">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4">
            <FormSection>
              <div className="flex min-h-10 flex-col justify-center gap-2">
                {canSwitchUser ? (
                  <Combobox
                    value={effectiveUserId ? String(effectiveUserId) : ""}
                    onValueChange={(value) => updateContext({ userId: Number(value) })}
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
              </div>
            </FormSection>

            <div className="flex flex-col gap-1 pt-1">
              <button
                type="button"
                className="text-left"
                onClick={() => openDatePicker()}
                aria-label={t("calendar.openDatePicker")}
              >
                <p className="min-w-0 text-3xl font-semibold leading-none tracking-[-0.05em] text-foreground sm:text-4xl">
                  {selectedDate.toLocaleDateString(settings.locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </button>
            </div>
            <div className="flex items-end justify-start gap-2">
              <div className="flex items-end justify-start">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  className="h-9 w-9 shrink-0 rounded-full"
                  onClick={() => openDatePicker()}
                  aria-label={t("calendar.openDatePicker")}
                >
                  <CalendarBlank size={16} weight="bold" />
                </Button>
              </div>
              <div className="flex items-end justify-end">
                <Button
                  variant={isNowContext ? "secondary" : "default"}
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={goToToday}
                  type="button"
                  aria-label={t("dashboard.today")}
                >
                  <ClockCounterClockwise size={16} weight="bold" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">{t("dashboard.records")}</p>
            <div className="divide-y divide-border/60">
              {entries.map((entry) => {
                const canEdit = evaluateTimeEntryPolicy({
                  mode: "edit",
                  role: companyIdentity?.user.role,
                  settings,
                  entryType: entry.entryType,
                  startDate: entry.entryDate,
                  endDate: entry.endDate,
                  todayDay,
                  hasHolidayInRange: false,
                  hasWeekendInRange:
                    entry.entryType === "work" &&
                    enumerateLocalDays(entry.entryDate, entry.endDate ?? entry.entryDate).some((day) =>
                      isWeekendDay(day, settings.weekendDays),
                    ),
                }).allowed;
                const canDelete = canEdit;
                const editHref = `/dashboard/records/${entry.id}/edit?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
                const supportText = getEntrySupportText(entry, customFieldsById, customFieldValueLabels);
                const isActiveWorkEntry =
                  entry.entryType === "work" &&
                  summary.activeEntry?.id === entry.id &&
                  !entry.endTime;
                const entryHeadline = getEntryHeadline(entry, getEntryLabel);
                const entryMeta =
                  entry.entryType === "work"
                    ? formatMinutes(
                        isActiveWorkEntry
                          ? calculateLiveWorkDurationMinutes(entry.startTime, null, settings)
                          : calculateLiveWorkDurationMinutes(entry.startTime, entry.endTime, settings),
                      )
                    : formatDayCount(entry.effectiveDayCount);

                return (
                  <div
                    key={entry.id}
                    className="grid min-h-12 grid-cols-[auto,minmax(0,1fr),auto] items-center gap-2 px-0 py-2"
                  >
                    <div>
                      <RecordStatusIcon
                        entryType={entry.entryType}
                        active={isActiveWorkEntry}
                        className={entryStateUi[entry.entryType].recordStatusClassName}
                      />
                    </div>
                    <div className="min-w-0 flex flex-col gap-1 overflow-hidden">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 whitespace-normal break-words text-sm font-medium leading-4 text-foreground">
                          {entryHeadline}
                        </p>
                        <Badge
                          variant={isActiveWorkEntry ? "destructive" : "secondary"}
                          className="shrink-0 rounded-full px-2 py-0 text-[11px] leading-5"
                        >
                          {entryMeta}
                        </Badge>
                      </div>
                      {supportText ? (
                        <p className="whitespace-normal break-words text-xs leading-4 text-muted-foreground">
                          {supportText}
                        </p>
                      ) : null}
                    </div>
                    <div className="relative z-10 flex shrink-0 items-center justify-end gap-0.5 self-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 p-0 text-muted-foreground/80"
                        disabled={!canDelete}
                        onPointerDown={triggerHapticFeedback}
                        onClick={() => canDelete && setPendingDeleteEntry(entry)}
                        aria-label={canDelete ? t("dashboard.deleteRecord") : t("dashboard.recordLocked")}
                      >
                        <Trash size={16} weight="bold" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 p-0 text-muted-foreground/80"
                        disabled={!canEdit}
                        onPointerDown={triggerHapticFeedback}
                        onClick={() => canEdit && navigate(editHref)}
                        aria-label={canEdit ? t("dashboard.editRecord") : t("dashboard.recordLocked")}
                      >
                        <PencilSimple size={16} weight="bold" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {entries.length === 0 ? (
                <div className="grid min-h-12 grid-cols-[auto,minmax(0,1fr),auto] items-center gap-2 px-0 py-2 text-muted-foreground transition-colors">
                  <EmptyRecordIcon />
                  <div className="min-w-0 flex items-center overflow-hidden">
                    <p className="truncate text-sm font-medium leading-4 text-foreground/80">
                      {t("dashboard.noRecords")}
                    </p>
                  </div>
                  <div className="h-7 w-[4rem]" aria-hidden="true" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Stack>
      </PageLoadBoundary>
      <PageDock cacheKey={dashboardDockKey}>
        <DockActionStack
          primary={dashboardLoading ? null : isTabletMode ? (
            <>
              {dockShowsStop || dockShowsPlay ? (
                <Button
                  className={
                    summary.activeEntry
                      ? "h-16 w-16 rounded-[999px] bg-destructive text-destructive-foreground transition-[background-color,color,transform,opacity] duration-200 ease-out hover:opacity-95 active:scale-95"
                      : "h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-[background-color,color,transform,opacity] duration-200 ease-out hover:opacity-95 active:scale-95"
                  }
                  size="icon"
                  type="button"
                  disabled={!canUseTabletPunch}
                  onClick={handleTabletPunch}
                  aria-label={summary.activeEntry ? t("dashboard.stopWork") : t("dashboard.startWork")}
                >
                  <span className="relative block h-8 w-8">
                    <Play
                      size={30}
                      weight="fill"
                      className={cn(
                        "absolute inset-0 m-auto transition-opacity duration-300 ease-out",
                        dockButtonMode === "play" ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Stop
                      size={30}
                      weight="fill"
                      className={cn(
                        "absolute inset-0 m-auto transition-opacity duration-300 ease-out",
                        dockButtonMode === "stop" ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </span>
                </Button>
              ) : canAddRecordButton ? (
                <Button
                  asChild
                  className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
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
                  className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-transform duration-150 ease-out"
                  size="icon"
                  type="button"
                  aria-label={t("dashboard.addRecordUnavailable")}
                >
                  <Plus size={30} weight="bold" />
                </Button>
              )}
            </>
          ) : canAddRecordButton ? (
            <Button
              asChild
              className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-transform duration-150 ease-out hover:opacity-90 active:scale-95"
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
              className="h-16 w-16 rounded-[999px] bg-primary text-primary-foreground transition-transform duration-150 ease-out"
              size="icon"
              type="button"
              aria-label={t("dashboard.addRecordUnavailable")}
            >
              <Plus size={30} weight="bold" />
            </Button>
          )}
          secondary={!dashboardLoading && isTabletMode && dockShowsPlay && canAddRecordButton ? (
            <DockActionButton asChild onPointerDown={triggerHapticFeedback}>
              <Link to={createRecordHref}>{t("recordEditor.addEntry")}</Link>
            </DockActionButton>
          ) : null}
          message={!dashboardLoading && recordDockMessages.length > 0 ? (
            <HintStack messages={recordDockMessages} className="text-center" />
          ) : null}
        />
      </PageDock>
    </FormPage>
  );
}
