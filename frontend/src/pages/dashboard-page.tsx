import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, CalendarBlank, CircleNotch, ClockCounterClockwise, FirstAidKit, PencilSimple, Play, Plus, Stop, Trash, UmbrellaSimple, ClipboardText } from "phosphor-react";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  PublicHolidayRecord,
  TimeEntryView,
} from "@shared/types/models";
import type { DashboardPageSnapshotResponse, ProjectTaskManagementResponse, StartTimerRequirement } from "@shared/types/api";
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
import { CompanyDateDisplay } from "@/components/company-date-display";
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
import { evaluateTimeEntryAccess, formatStartTimerRequirementsMessage } from "@/lib/time-entry-access";
import { evaluateTimerSetupRequirements } from "@/lib/timer-setup-policy";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
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
    year: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
    vacation: { entitledDays: 0, usedDays: 0, availableDays: 0 },
    timeOffInLieu: { earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 },
  },
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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

function formatDayCount(value: number) {
  const normalized = Math.max(0, value);
  const hasFraction = Math.abs(normalized % 1) > 0;
  const formatted = normalized.toFixed(hasFraction ? 1 : 0);
  const suffix = Math.abs(normalized - 1) < 0.01 ? "day" : "days";
  return `${formatted} ${suffix}`;
}

function hasRenderableCustomFieldValue(value: string | number | boolean | undefined) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

function buildEntrySecondaryBadges(
  entry: TimeEntryView,
  projectData: ProjectTaskManagementResponse | null,
  customFieldValueLabels: Map<string, string>,
  settings: Pick<CompanySettings, "customFields">,
) {
  const badges: Array<{ key: string; label: string }> = [];

  if (entry.projectId) {
    const project = projectData?.projects.find((item) => item.id === entry.projectId);
    if (project) {
      badges.push({
        key: `project-${project.id}`,
        label: project.name,
      });
    }
  }

  if (entry.taskId) {
    const task = projectData?.tasks.find((item) => item.id === entry.taskId);
    if (task) {
      badges.push({
        key: `task-${task.id}`,
        label: task.title,
      });
    }
  }

  for (const field of getCustomFieldsForTarget(settings.customFields, { scope: "time_entry", entryType: entry.entryType })) {
    const value = entry.customFieldValues[field.id];
    if (!hasRenderableCustomFieldValue(value)) {
      continue;
    }

    const resolved = resolveCustomFieldValueLabel(field, value, customFieldValueLabels);
    if (!resolved) {
      continue;
    }

    badges.push({
      key: `field-${field.id}`,
      label: `${field.label}: ${resolved}`,
    });
  }

  if (badges.length <= 3) {
    return badges;
  }

  return [
    ...badges.slice(0, 2),
    {
      key: "more",
      label: `+${badges.length - 2}`,
    },
  ];
}

function triggerHapticFeedback() {
  if (
    typeof navigator !== "undefined" &&
    navigator.vibrate &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.userActivation?.isActive
  ) {
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

type EntryRowChipKind = TimeEntryView["entryType"] | "none" | "edit" | "delete";

function getEntryRowChipIcon(kind: EntryRowChipKind, active: boolean) {
  if (kind === "none") return ClipboardText;
  if (kind === "edit") return PencilSimple;
  if (kind === "delete") return Trash;
  if (active) return CircleNotch;
  if (kind === "work") return Briefcase;
  if (kind === "vacation") return UmbrellaSimple;
  if (kind === "time_off_in_lieu") return ClockCounterClockwise;
  return FirstAidKit;
}

function getEntryRowChipClasses(kind: EntryRowChipKind) {
  if (kind === "none") {
    return "border-border/60 bg-muted/40 text-muted-foreground";
  }

  if (kind === "edit") {
    return "border-border/70 bg-transparent text-muted-foreground hover:bg-muted/50";
  }

  if (kind === "delete") {
    return "border-border/70 bg-transparent text-muted-foreground hover:bg-muted/50";
  }

  return "";
}

function EntryRowChip({
  kind,
  label,
  toneClassName,
  leadingIcon,
  active = false,
  button = false,
  onClick,
  disabled,
  ariaLabel,
}: {
  kind: EntryRowChipKind;
  label?: string;
  toneClassName?: string;
  leadingIcon?: ReactNode;
  active?: boolean;
  button?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const Icon = getEntryRowChipIcon(kind, active);
  const badgeClassName = cn(
    "inline-flex h-8 max-w-full min-w-0 flex-[0_1_auto] items-center gap-1 overflow-hidden rounded-full border px-2.5 text-[12px] leading-5 transition-colors",
    getEntryRowChipClasses(kind),
    toneClassName,
  );

  if (button) {
    return (
      <Button
        variant="ghost"
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn("h-8 w-8 rounded-full p-0 text-muted-foreground/80 hover:bg-muted/50", disabled ? "opacity-60" : null)}
      >
        <Icon size={13} weight={active ? "bold" : "fill"} className={cn("shrink-0 text-current", active ? "animate-spin" : undefined)} />
      </Button>
    );
  }

  return (
    <Badge variant="outline" className={badgeClassName}>
      {leadingIcon ? <span className="shrink-0">{leadingIcon}</span> : null}
      {label ? <span className="min-w-0 truncate">{label}</span> : null}
    </Badge>
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
  const [projectData, setProjectData] = useState<ProjectTaskManagementResponse | null>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<TimeEntryView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [tabletPunchSetupOpen, setTabletPunchSetupOpen] = useState(false);
  const [tabletPunchValues, setTabletPunchValues] = useState<Record<string, string | number | boolean>>({});
  const [tabletPunchProjectId, setTabletPunchProjectId] = useState("");
  const [tabletPunchTaskId, setTabletPunchTaskId] = useState("");
  const [tabletPunchServerRequirements, setTabletPunchServerRequirements] = useState<StartTimerRequirement[]>([]);
  const [tabletPunchSubmitting, setTabletPunchSubmitting] = useState(false);
  const [summaryPeriod, setSummaryPeriod] = useState<"week" | "month" | "year">("week");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => parseDayParam(searchParams.get("day")));
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => parseDayParam(searchParams.get("day")));
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));

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
  const selectedUser = availableUsers.find(
    (user) => user.id === effectiveUserId,
  );
  const selectedUserName =
    selectedUser?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const dashboardPageResource = usePageResource<DashboardPageSnapshotResponse>({
    enabled: Boolean(companySession) && Boolean(effectiveUserId),
    deps: [companySession?.token, effectiveUserId, selectedDayKey, visibleMonth.getFullYear(), visibleMonth.getMonth(), t],
    minPendingMs: 0,
    load: async () => {
      if (!companySession || !effectiveUserId) {
        return {
          summary: defaultSummary,
          entries: [],
          calendar: {
            month: formatLocalDay(startOfMonth(selectedDate)),
            holidays: [],
            dayStates: {},
          },
        };
      }

      return api.getDashboardPageSnapshot(companySession.token, {
        targetUserId: effectiveUserId,
        targetDay: selectedDayKey,
        targetMonth: formatLocalDay(startOfMonth(visibleMonth)),
      });
    },
  });
  const dashboardPageErrorRef = useRef<unknown>(null);
  const dashboardPageIsSettled = dashboardPageResource.hasData;
  const dashboardSnapshot =
    dashboardPageResource.data ?? {
      summary: defaultSummary,
      entries: [],
      calendar: {
        month: formatLocalDay(startOfMonth(selectedDate)),
        holidays: [],
        dayStates: {},
      },
    };
  const entries = dashboardSnapshot.entries;
  const summary = dashboardSnapshot.summary;
  const dayMinutes = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
    [entries],
  );
  const summaryPeriodStats =
    summaryPeriod === "week"
      ? summary.contractStats.week
      : summaryPeriod === "month"
        ? summary.contractStats.month
        : summary.contractStats.year;
  const summaryPeriodLabel =
    summaryPeriod === "week"
      ? t("dashboard.periodWeek")
      : summaryPeriod === "month"
        ? t("dashboard.periodMonth")
        : t("dashboard.periodYear");
  const cycleSummaryPeriod = useCallback(() => {
    setSummaryPeriod((current) => (current === "week" ? "month" : current === "month" ? "year" : "week"));
  }, []);
  const previousSelectedDayKeyRef = useRef(selectedDayKey);
  const companyTimeZone = companySettings?.timeZone ?? settings.timeZone;
  const todayDay = getLocalNowSnapshot(new Date(), companyTimeZone).localDay;
  const selectedDayPastDistance = getPastDayDistance(selectedDayKey, todayDay);
  const selectedDayFutureDistance = getFutureDayDistance(selectedDayKey, todayDay);
  const isNowContext = isToday(selectedDate, companyTimeZone);
  const calendarHolidays = dashboardSnapshot.calendar.holidays;
  const holidayDateSet = useMemo(() => new Set(calendarHolidays.map((holiday) => holiday.date)), [calendarHolidays]);
  const selectedDayIsWeekend = isWeekendDay(selectedDayKey, settings.weekendDays);
  const selectedHoliday = useMemo(
    () => calendarHolidays.find((holiday) => holiday.date === selectedDayKey),
    [calendarHolidays, selectedDayKey]
  );
  const selectedDayIsHoliday = holidayDateSet.has(selectedDayKey);
  const calendarHolidayDates = useMemo(
    () => calendarHolidays.map((holiday) => holiday.date),
    [calendarHolidays],
  );
  const calendarDayStates = dashboardSnapshot.calendar.dayStates;
  useEffect(() => {
    if (!dashboardPageResource.error || dashboardPageErrorRef.current === dashboardPageResource.error) {
      return;
    }

    dashboardPageErrorRef.current = dashboardPageResource.error;
    toast({
      title: t("dashboard.couldNotLoadRecords"),
      description: dashboardPageResource.error instanceof Error ? dashboardPageResource.error.message : "Request failed",
    });
  }, [dashboardPageResource.error, t]);
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
  const selectedDayHasAnyEntry = selectedDayHasWorkEntry || selectedDayHasLeaveEntry;
  const selectedDayAccess = useMemo(
    () =>
      evaluateTimeEntryAccess({
        scope: "dashboard",
        mode: "create",
        includePolicy: false,
        role: companyIdentity?.user.role,
        settings,
        entryType: "work",
        startDate: selectedDayKey,
        endDate: selectedDayKey,
        todayDay,
        hasHolidayInRange: selectedDayIsHoliday,
        hasWeekendInRange: selectedDayIsWeekend,
        hasExistingEntry: selectedDayHasAnyEntry,
      }),
    [
      companyIdentity?.user.role,
      selectedDayHasAnyEntry,
      selectedDayIsHoliday,
      selectedDayIsWeekend,
      selectedDayKey,
      settings,
      todayDay,
    ],
  );
  const workEntryAllowed = allowedEntryTypes.work.allowed && (settings.allowIntersectingRecords || !selectedDayHasLeaveEntry);
  const vacationAllowed = allowedEntryTypes.vacation.allowed && summary.contractStats.vacation.availableDays > 0;
  const timeOffAllowed = allowedEntryTypes.timeOffInLieu.allowed && summary.contractStats.timeOffInLieu.availableMinutes > 0;
  const leaveEntryAllowed = (allowedEntryTypes.sickLeave.allowed || vacationAllowed || timeOffAllowed) && (settings.allowIntersectingRecords || !selectedDayHasAnyEntry);
  const canCreateRecord = workEntryAllowed || leaveEntryAllowed;
  const singleRecordBlocked = selectedDayAccess.blocks.some((block) => block.kind === "single_record_per_day");
  const canUseTabletPunch = summary.activeEntry
    ? true
    : isNowContext && workEntryAllowed && !singleRecordBlocked;
  const singleRecordMessage = singleRecordBlocked ? t("dashboard.oneRecordPerDay") : null;
  const canAddRecordButton = canCreateRecord && !singleRecordBlocked;
  const createRecordMessage = singleRecordBlocked
    ? null
    : selectedDayPolicy.reason === "insert_limit"
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
      : !settings.allowIntersectingRecords && selectedDayHasWorkEntry
      ? t("dashboard.workDayAlreadyBooked")
      : !settings.allowIntersectingRecords && selectedDayHasLeaveEntry
      ? t("recordEditor.leaveTypeAlreadyBooked")
      : null;
  const recordDockMessages = useMemo(
    () => [singleRecordMessage, createRecordMessage].filter((value): value is string => Boolean(value)),
    [createRecordMessage, singleRecordMessage],
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
  const tabletPunchRequirements = useMemo(
    () =>
      evaluateTimerSetupRequirements({
        settings,
        projectId: tabletPunchProjectId,
        taskId: tabletPunchTaskId,
        selectedProjectExists: !settings.projectsEnabled || Boolean(selectedTabletProject),
        selectedTaskExists: !settings.tasksEnabled || availableTabletTasks.some((task) => task.id === Number(tabletPunchTaskId)),
        requiredCustomFields: requiredTabletWorkFields,
        customFieldValues: tabletPunchValues,
      }),
    [
      availableTabletTasks,
      requiredTabletWorkFields,
      selectedTabletProject,
      settings,
      tabletPunchProjectId,
      tabletPunchTaskId,
      tabletPunchValues,
    ],
  );
  useEffect(() => {
    if (tabletPunchServerRequirements.length > 0) {
      setTabletPunchServerRequirements([]);
    }
  }, [tabletPunchProjectId, tabletPunchServerRequirements.length, tabletPunchTaskId, tabletPunchValues]);

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
  const goToToday = useCallback((options?: { closePicker?: boolean }) => {
    const todayDate = parseLocalDay(getLocalNowSnapshot(new Date(), companyTimeZone).localDay) ?? new Date();
    updateContext({ day: todayDate });
    setDraftDate(todayDate);
    setVisibleMonth(startOfMonth(todayDate));

    if (options?.closePicker) {
      setDatePickerOpen(false);
    }
  }, [companyTimeZone, updateContext]);
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
    await dashboardPageResource.reload();
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
      if (!tabletPunchRequirements.ready) {
        setTabletPunchSetupOpen(true);
        return;
      }
      const preflight = await api.checkStartTimer(companySession.token, {
        customFieldValues: input.customFieldValues,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
      });
      if (!preflight.ready) {
        setTabletPunchServerRequirements(preflight.requirements);
        setTabletPunchSetupOpen(true);
        return;
      }
      await api.startTimer(companySession.token, {
        customFieldValues: input.customFieldValues,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
      });
      setTabletPunchSetupOpen(false);
      setTabletPunchValues({});
      setTabletPunchProjectId("");
      setTabletPunchTaskId("");
      setTabletPunchServerRequirements([]);
      await refreshDashboardViews();
    } catch (error) {
      try {
        const retry = await api.checkStartTimer(companySession.token, {
          customFieldValues: input.customFieldValues,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
        });
        setTabletPunchServerRequirements(retry.requirements);
        setTabletPunchSetupOpen(true);
      } catch {
        // keep the setup open, but avoid surfacing a stale validation path
      }
      toast({
        title: t("dashboard.couldNotStartTimer"),
        description: "Request failed"
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

    setTabletPunchServerRequirements([]);
    setTabletPunchSetupOpen(true);
  }

  const createRecordHref = buildRecordEditorHref(
    effectiveUserId,
    selectedDate,
    futurePlannedLeaveOnly ? (vacationAllowed ? "vacation" : timeOffAllowed ? "time_off_in_lieu" : undefined) : undefined,
  );
  const dockShowsPlay = isNowContext && workEntryAllowed && !summary.activeEntry && !singleRecordBlocked;
  const dockShowsStop = Boolean(summary.activeEntry);
  const dockUsesPlus = !dockShowsStop && !dockShowsPlay;
  const dockButtonMode = summary.activeEntry ? "stop" : "play";
  const userOptions = availableUsers.map((user) => ({
    value: String(user.id),
    label: user.fullName,
  }));
  const tabletPunchRequirementsMessage = useMemo(
    () => formatStartTimerRequirementsMessage(tabletPunchRequirements.ready ? tabletPunchServerRequirements : tabletPunchRequirements.requirements, t),
    [tabletPunchRequirements, tabletPunchServerRequirements, t],
  );
  const canStartTabletPunch = canUseTabletPunch && tabletPunchRequirements.ready && tabletPunchServerRequirements.length === 0;
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
      dockShowsPlay,
      dockShowsStop,
      isTabletMode,
      singleRecordMessage,
      summary.activeEntry?.id,
    ],
  );
  const calendarDockKey = useMemo(
    () => [
      "calendar-picker",
      formatLocalDay(draftDate),
      formatLocalDay(visibleMonth),
      isNowContext ? "1" : "0",
    ].join("|"),
    [draftDate, isNowContext, visibleMonth],
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
      label: t("dashboard.today"),
      onClick: () => goToToday(),
    });
    return () => setHomeAction(null);
  }, [closeDatePicker, datePickerOpen, goToToday, setHomeAction, tabletPunchSetupOpen, t]);

  if (isTabletMode && tabletPunchSetupOpen) {
    return (
      <FormPage className="min-h-0 flex-none">
        <PageBackAction onClick={() => {
          setTabletPunchSetupOpen(false);
          setTabletPunchServerRequirements([]);
        }} label={t("common.close")} />
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
                  setTabletPunchServerRequirements([]);
                }}
                type="button"
                disabled={tabletPunchSubmitting}
              >
                {t("common.cancel")}
              </DockActionButton>
            }
            message={tabletPunchRequirementsMessage ? (
              <HintStack messages={[tabletPunchRequirementsMessage]} className="text-center" />
            ) : null}
          />
        </PageDock>
      </FormPage>
    );
  }

  if (datePickerOpen) {
    return (
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
        <PageDock cacheKey={calendarDockKey}>
          <DockActionStack
            secondary={(
              <DockActionButton
                variant={isNowContext ? "secondary" : "default"}
                type="button"
                onClick={() => goToToday({ closePicker: true })}
                aria-label={t("dashboard.today")}
              >
                <ClockCounterClockwise size={14} weight="bold" />
                <span className="ml-2">{t("dashboard.today")}</span>
              </DockActionButton>
            )}
            message={(
              <CompanyDateDisplay
                day={formatLocalDay(draftDate)}
                centered
                className="gap-0.5"
                dateClassName="text-center text-xs font-medium leading-5 text-muted-foreground"
                weekdayClassName="text-center text-[11px] leading-4 text-muted-foreground/80"
              />
            )}
          />
        </PageDock>
      </FormPage>
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
        loading={!dashboardPageResource.hasData && !dashboardPageResource.error}
        skeleton={null}
      >
      <Stack gap="lg" className="min-h-full flex-1">
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-col gap-3">
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

            <div className="flex flex-col gap-3 pt-1">
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() => openDatePicker()}
                aria-label={t("calendar.openDatePicker")}
              >
                <CompanyDateDisplay
                  day={formatLocalDay(selectedDate)}
                  className="gap-0.5"
                  dateClassName="text-3xl font-semibold leading-none tracking-[-0.05em] sm:text-4xl"
                  weekdayClassName="text-xs font-medium leading-none tracking-[-0.01em] sm:text-sm"
                />
              </button>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
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
                  <Button
                    variant={isNowContext ? "secondary" : "default"}
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    onClick={() => goToToday()}
                    type="button"
                    aria-label={t("dashboard.today")}
                  >
                    <ClockCounterClockwise size={16} weight="bold" />
                  </Button>
                </div>
                <div className="flex min-w-0 flex-nowrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 rounded-full px-3 text-xs font-medium"
                    onClick={cycleSummaryPeriod}
                    type="button"
                    aria-label={summaryPeriodLabel}
                    title={summaryPeriodLabel}
                  >
                    <span className="max-w-[6.5rem] truncate">{summaryPeriodLabel}</span>
                  </Button>
                  <Badge
                    variant="outline"
                    className="flex h-9 min-w-0 flex-1 items-center justify-start rounded-full px-3 text-xs font-medium text-muted-foreground"
                  >
                    <span className="min-w-0 truncate">
                      {t("dashboard.actualLabel")} {formatMinutes(summaryPeriodStats.recordedMinutes)} / {t("dashboard.targetLabel")} {formatMinutes(summaryPeriodStats.expectedMinutes)}
                    </span>
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-col gap-2">
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
                const isActiveWorkEntry =
                  entry.entryType === "work" &&
                  summary.activeEntry?.id === entry.id &&
                  !entry.endTime;
                const secondaryBadges = buildEntrySecondaryBadges(
                  entry,
                  projectData,
                  customFieldValueLabels,
                  settings,
                );
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
                    className="grid grid-cols-[minmax(0,1fr),auto] items-center gap-2 px-0"
                  >
                    <div className="min-w-0 flex flex-1 flex-nowrap items-center gap-2 overflow-hidden pr-1">
                      {isActiveWorkEntry ? (
                        <EntryRowChip
                          kind="none"
                          leadingIcon={
                            <CircleNotch size={12} weight="bold" className="shrink-0 animate-spin text-current" />
                          }
                          toneClassName={entryStateUi[entry.entryType].badgeClassName}
                        />
                      ) : null}
                      <EntryRowChip
                        kind={entry.entryType}
                        active={isActiveWorkEntry}
                        toneClassName={entryStateUi[entry.entryType].badgeClassName}
                        label={getEntryLabel(entry.entryType)}
                      />
                      <EntryRowChip
                        kind="none"
                        label={entryMeta}
                        toneClassName="border-border/70 bg-secondary/70 text-secondary-foreground"
                      />
                      {secondaryBadges.length > 0 ? (
                        <EntryRowChip
                          kind="none"
                          label={secondaryBadges.map((badge) => badge.label).join(" · ")}
                          toneClassName="border-border/70 bg-transparent text-muted-foreground"
                        />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2 self-center">
                      <EntryRowChip
                        kind="delete"
                        button
                        disabled={!canDelete}
                        onClick={() => canDelete && setPendingDeleteEntry(entry)}
                        ariaLabel={canDelete ? t("dashboard.deleteRecord") : t("dashboard.recordLocked")}
                      />
                      <EntryRowChip
                        kind="edit"
                        button
                        disabled={!canEdit}
                        onClick={() => canEdit && navigate(editHref)}
                        ariaLabel={canEdit ? t("dashboard.editRecord") : t("dashboard.recordLocked")}
                      />
                    </div>
                  </div>
                );
              })}

              {entries.length === 0 ? (
                <EntryRowChip
                  kind="none"
                  label={t("dashboard.noRecords")}
                  toneClassName="border-border/60 bg-muted/40 text-muted-foreground"
                />
              ) : null}
          </div>
        </div>
      </Stack>
        {dashboardPageIsSettled ? (
          <PageDock cacheKey={dashboardDockKey}>
        <DockActionStack
          primary={isTabletMode ? (
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
          secondary={isTabletMode && dockShowsPlay && canAddRecordButton ? (
            <DockActionButton asChild onPointerDown={triggerHapticFeedback}>
              <Link to={createRecordHref}>{t("recordEditor.addEntry")}</Link>
            </DockActionButton>
          ) : null}
          message={recordDockMessages.length > 0 ? (
            <HintStack messages={recordDockMessages} className="text-center" />
          ) : null}
        />
          </PageDock>
        ) : null}
      </PageLoadBoundary>
    </FormPage>
  );
}
