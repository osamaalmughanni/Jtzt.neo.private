import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  PublicHolidayRecord,
  TimeEntryType,
} from "@shared/types/models";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { evaluateTimeEntryPolicy, getAllowedEntryTypesForDay, getFutureDayDistance, getPastDayDistance } from "@shared/utils/time-entry-policy";
import {
  combineLocalDayAndTimeToIsoInTimeZone,
  countEffectiveLeaveDays,
  enumerateLocalDays,
  formatLocalDay,
  getLocalNowSnapshot,
  isWeekendDay,
  toClockTimeValue,
} from "@shared/utils/time";
import { getCustomFieldsForTarget } from "@shared/utils/custom-fields";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CustomFieldField } from "@/components/custom-field-field";
import { EntryTypeTabs } from "@/components/entry-type-tabs";
import { LeaveStateBars } from "@/components/leave-state-bars";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { TimeInput } from "@/components/ui/time-input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompanySettings } from "@/lib/company-settings";
import { toast } from "@/lib/toast";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";
import { formatMinutes } from "@shared/utils/time";

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

function canManageOtherUsers(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function getHolidayDisplayName(holiday: PublicHolidayRecord | undefined) {
  if (!holiday) {
    return null;
  }

  return holiday.localName?.trim() || holiday.name?.trim() || null;
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

function groupAssignments<T extends { projectId: number }>(rows: T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.projectId) ?? [];
    current.push(row);
    grouped.set(row.projectId, current);
  }
  return grouped;
}

interface DashboardRecordEditorPageProps {
  mode: "create" | "edit";
}

function EntryScheduleFields({
  locale,
  timeZone,
  settings,
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
  settings: Pick<CompanySettings, "firstDayOfWeek" | "weekendDays">;
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
          <DateInput
            value={startDate}
            locale={locale}
            firstDayOfWeek={settings.firstDayOfWeek}
            weekendDays={settings.weekendDays}
            onChange={onStartDateChange}
          />
        </Field>
        <Field className="flex-1" label={toDateLabel}>
          <DateInput
            value={endDate}
            locale={locale}
            firstDayOfWeek={settings.firstDayOfWeek}
            weekendDays={settings.weekendDays}
            onChange={onEndDateChange}
          />
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
  const { settings: companySettings } = useCompanySettings();
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [projectData, setProjectData] = useState<ProjectTaskManagementResponse | null>(null);
  const initialEntryType = (searchParams.get("type") as TimeEntryType | null) ?? "work";
  const [entryType, setEntryType] = useState<TimeEntryType>(
    initialEntryType === "vacation" || initialEntryType === "sick_leave" || initialEntryType === "time_off_in_lieu" ? initialEntryType : "work"
  );
  const [startDate, setStartDate] = useState(parseDayParam(searchParams.get("day")));
  const [endDate, setEndDate] = useState(parseDayParam(searchParams.get("day")));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | number | boolean>>({});
  const [projectId, setProjectId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [holidays, setHolidays] = useState<PublicHolidayRecord[]>([]);
  const [timeOffInLieuBalance, setTimeOffInLieuBalance] = useState({ earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 });
  const [timeOffInLieuRequestedMinutes, setTimeOffInLieuRequestedMinutes] = useState(0);
  const [vacationBalance, setVacationBalance] = useState({ entitledDays: 0, usedDays: 0, availableDays: 0 });
  const [vacationRequestedDays, setVacationRequestedDays] = useState(0);
  const [sickLeaveUsedDays, setSickLeaveUsedDays] = useState(0);
  const [sickLeaveElapsedDays, setSickLeaveElapsedDays] = useState(0);
  const [rangeEntryConflict, setRangeEntryConflict] = useState({ hasWork: false, hasLeave: false });
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>(defaultSummary);

  const canSwitchUser = !isTabletMode && canManageOtherUsers(companyIdentity?.user.role);
  const selectedDay = parseDayParam(searchParams.get("day"));
  const dashboardDay = selectedDay;
  const effectiveUserId =
    canSwitchUser
      ? Number(searchParams.get("user") ?? companyIdentity?.user.id ?? 0) || companyIdentity?.user.id || 0
      : companyIdentity?.user.id || 0;
  const backTo = `/dashboard?user=${effectiveUserId}&day=${dashboardDay}`;
  const activeCustomFields = useMemo(
    () => getCustomFieldsForTarget(settings.customFields, { scope: "time_entry", entryType }),
    [entryType, settings.customFields],
  );
  const projectUsersByProject = useMemo(
    () => groupAssignments(projectData?.projectUsers ?? []),
    [projectData?.projectUsers],
  );
  const projectTasksByProject = useMemo(
    () => groupAssignments(projectData?.projectTasks ?? []),
    [projectData?.projectTasks],
  );
  const userProjects = useMemo(() => {
    const projects = projectData?.projects ?? [];
    const userId = effectiveUserId;
    return projects.filter((project) => {
      if (project.allowAllUsers) {
        return true;
      }

      const assignments = projectUsersByProject.get(project.id) ?? [];
      return assignments.some((assignment) => assignment.userId === userId);
    });
  }, [effectiveUserId, projectData?.projects, projectUsersByProject]);
  const selectedProjectId = projectId ? Number(projectId) : null;
  const selectedProject = userProjects.find((project) => project.id === selectedProjectId) ?? null;
  const availableTasks = useMemo(() => {
    if (!selectedProject || !projectData?.tasks) {
      return [];
    }

    if (selectedProject.allowAllTasks) {
      return projectData.tasks.filter((task) => task.isActive);
    }

    const taskAssignments = projectTasksByProject.get(selectedProject.id) ?? [];
    const allowedTaskIds = new Set(taskAssignments.map((assignment) => assignment.taskId));
    return projectData.tasks.filter((task) => task.isActive && allowedTaskIds.has(task.id));
  }, [projectData?.tasks, projectTasksByProject, selectedProject]);
  const projectOptions = useMemo(
    () => userProjects.map((project) => ({
      value: String(project.id),
      label: project.description?.trim() ? `${project.name} - ${project.description.trim()}` : project.name,
    })),
    [userProjects],
  );
  const taskOptions = useMemo(
    () => availableTasks.map((task) => ({
      value: String(task.id),
      label: task.title,
    })),
    [availableTasks],
  );

  useEffect(() => {
    if (!selectedProjectId) {
      if (taskId) {
        setTaskId("");
      }
      return;
    }

    if (!userProjects.some((project) => project.id === selectedProjectId)) {
      setProjectId("");
      setTaskId("");
      return;
    }

    if (taskId && !availableTasks.some((task) => task.id === Number(taskId))) {
      setTaskId("");
    }
  }, [availableTasks, selectedProjectId, taskId, userProjects]);
  const selectedUserName =
    users.find((user) => user.id === effectiveUserId)?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const resolvedEndDate = endDate;
  const rangeEndDate = resolvedEndDate >= startDate ? resolvedEndDate : startDate;
  const todayDay = getLocalNowSnapshot(new Date(), settings.timeZone).localDay;
  const holidaySet = useMemo(() => new Set(holidays.map((holiday) => holiday.date)), [holidays]);
  const selectedDayIsWeekend = isWeekendDay(startDate, settings.weekendDays);
  const blockedHoliday = useMemo(
    () =>
      entryType === "work" && !settings.allowRecordsOnHolidays
        ? holidays.find((holiday) => enumerateLocalDays(startDate, resolvedEndDate).includes(holiday.date)) ?? null
        : null,
    [entryType, holidays, resolvedEndDate, settings.allowRecordsOnHolidays, startDate]
  );
  const holidayBlocked = blockedHoliday !== null;
  const leaveMetrics = useMemo(
    () => countEffectiveLeaveDays(startDate, resolvedEndDate, holidaySet, settings.weekendDays),
    [holidaySet, resolvedEndDate, settings.weekendDays, startDate],
  );
  const policy = evaluateTimeEntryPolicy({
    mode,
    role: companyIdentity?.user.role,
    settings,
    entryType,
    startDate,
    endDate: resolvedEndDate,
    todayDay,
    hasHolidayInRange: holidayBlocked,
    hasWeekendInRange: selectedDayIsWeekend || enumerateLocalDays(startDate, resolvedEndDate).some((day) => isWeekendDay(day, settings.weekendDays)),
  });
  const allowedEntryTypes = getAllowedEntryTypesForDay({
    role: companyIdentity?.user.role,
    settings,
    day: startDate,
    todayDay,
    isHoliday: holidaySet.has(startDate),
    isWeekend: selectedDayIsWeekend,
  });
  const startDatePastDistance = getPastDayDistance(startDate, todayDay);
  const futurePlanningDistance = getFutureDayDistance(rangeEndDate, todayDay);
  const futurePlannedLeaveOnly =
    policy.reason === "future_restricted" &&
    allowedEntryTypes.onlyPlannedLeaveAllowed &&
    futurePlanningDistance > 0;
  const dayLimitError = futurePlannedLeaveOnly
    ? t("recordEditor.futureVacationOnly", {
        date: rangeEndDate,
        days: futurePlanningDistance,
      })
    : policy.reason === "holiday_work_blocked"
    ? t("recordEditor.holidayWorkBlocked", {
        date: blockedHoliday?.date ?? startDate,
        holiday: getHolidayDisplayName(blockedHoliday ?? undefined) ?? (blockedHoliday?.date ?? startDate),
      })
    : policy.reason === "weekend_work_blocked"
    ? t("recordEditor.weekendWorkBlocked", {
        date: startDate,
      })
    : policy.reason === "insert_limit"
      ? t("recordEditor.insertLimitDetailed", {
          limit: settings.insertDaysLimit,
          days: startDatePastDistance,
          date: startDate,
        })
      : policy.reason === "edit_limit"
        ? t("recordEditor.editLimitDetailed", {
            limit: settings.editDaysLimit,
            days: startDatePastDistance,
            date: startDate,
          })
        : null;
  const entryTypeTabs: Array<{ value: TimeEntryType; label: string }> = [
    {
      value: "work",
      label: t("recordEditor.working"),
    },
    {
      value: "vacation",
      label: t("recordEditor.vacation"),
    },
    {
      value: "time_off_in_lieu",
      label: t("recordEditor.timeOffInLieu"),
    },
    {
      value: "sick_leave",
      label: t("recordEditor.sickLeave"),
    },
  ];
  const timeOffInLieuError =
    entryType === "time_off_in_lieu" && timeOffInLieuRequestedMinutes > 0 && timeOffInLieuRequestedMinutes > timeOffInLieuBalance.availableMinutes
      ? t("recordEditor.timeOffInLieuInsufficient", {
          available: `${(Math.max(0, timeOffInLieuBalance.availableMinutes) / 60).toFixed(1)}h`,
          requested: `${(timeOffInLieuRequestedMinutes / 60).toFixed(1)}h`,
        })
      : null;
  const vacationError =
    entryType === "vacation" && vacationRequestedDays > Math.max(0, vacationBalance.availableDays)
      ? t("recordEditor.vacationInsufficient", {
          available: Math.max(0, vacationBalance.availableDays).toFixed(2),
          requested: vacationRequestedDays.toFixed(2),
        })
      : null;
  const workDayConflictError =
    entryType !== "work" && rangeEntryConflict.hasWork
      ? t("recordEditor.workDayAlreadyBooked")
      : entryType !== "work" && rangeEntryConflict.hasLeave
        ? t("recordEditor.leaveTypeAlreadyBooked")
      : entryType === "work" && rangeEntryConflict.hasLeave
        ? t("recordEditor.leaveDayAlreadyBooked")
      : null;
  const blockingError = dayLimitError ?? workDayConflictError ?? vacationError ?? timeOffInLieuError;
  useEffect(() => {
    if (companySettings) {
      setSettings(companySettings);
    }
  }, [companySettings]);

  useEffect(() => {
    if (!companySession) return;
    if (!canSwitchUser) return;
    void api.listUsers(companySession.token).then((response) => setUsers(response.users)).catch(() => undefined);
  }, [canSwitchUser, companySession]);

  useEffect(() => {
    if (!companySession || !effectiveUserId) {
      setDashboardSummary(defaultSummary);
      return;
    }

    void api.getDashboard(companySession.token, canSwitchUser ? effectiveUserId : undefined, dashboardDay)
      .then((response) => setDashboardSummary(response.summary))
      .catch(() => setDashboardSummary(defaultSummary));
  }, [canSwitchUser, companySession, dashboardDay, effectiveUserId]);

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
    if (!companySession || settings.country.length !== 2) return;
    const nextYears = enumerateYears(startDate, resolvedEndDate);
    void Promise.all(nextYears.map((year) => api.getPublicHolidays(companySession.token, settings.country, year)))
      .then((responses) => setHolidays(responses.flatMap((response) => response.holidays)))
      .catch(() => setHolidays([]));
  }, [companySession, resolvedEndDate, settings.country, startDate]);

  useEffect(() => {
    if (!companySession || !effectiveUserId) {
      setTimeOffInLieuBalance({ earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 });
      setTimeOffInLieuRequestedMinutes(0);
      setVacationBalance({ entitledDays: 0, usedDays: 0, availableDays: 0 });
      setVacationRequestedDays(0);
      setSickLeaveUsedDays(0);
      setSickLeaveElapsedDays(0);
      return;
    }

    void Promise.all([
      api.getTimeOffInLieuBalance(companySession.token, {
        targetUserId: canSwitchUser ? effectiveUserId : undefined,
        excludeEntryId: mode === "edit" && entryId ? Number(entryId) : undefined,
        startDate,
        endDate: resolvedEndDate,
      }),
      api.getVacationBalance(companySession.token, {
        targetUserId: canSwitchUser ? effectiveUserId : undefined,
        excludeEntryId: mode === "edit" && entryId ? Number(entryId) : undefined,
        startDate,
        endDate: resolvedEndDate,
      }),
    ]).then(([timeOffResponse, vacationResponse]) => {
      setTimeOffInLieuBalance(timeOffResponse.balance);
      setTimeOffInLieuRequestedMinutes(timeOffResponse.requestedMinutes ?? 0);
      setVacationBalance(vacationResponse.balance);
      setVacationRequestedDays(vacationResponse.requestedDays ?? 0);
    }).catch(() => {
      setTimeOffInLieuBalance({ earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 });
      setTimeOffInLieuRequestedMinutes(0);
      setVacationBalance({ entitledDays: 0, usedDays: 0, availableDays: 0 });
      setVacationRequestedDays(0);
    });
  }, [canSwitchUser, companySession, effectiveUserId, endDate, entryId, mode, resolvedEndDate, startDate]);

  useEffect(() => {
    if (!companySession || !effectiveUserId) {
      setSickLeaveUsedDays(0);
      setSickLeaveElapsedDays(0);
      return;
    }

    void api.getSickLeaveSummary(companySession.token, {
      targetUserId: canSwitchUser ? effectiveUserId : undefined,
    }).then((response) => {
      setSickLeaveUsedDays(response.summary.usedDays);
      setSickLeaveElapsedDays(response.summary.elapsedDays);
    }).catch(() => {
      setSickLeaveUsedDays(0);
      setSickLeaveElapsedDays(0);
    });
  }, [canSwitchUser, companySession, effectiveUserId]);

  useEffect(() => {
    if (!companySession || !effectiveUserId) {
      setRangeEntryConflict({ hasWork: false, hasLeave: false });
      return;
    }

    void api.listTimeEntries(companySession.token, {
      from: startDate,
      to: resolvedEndDate,
      targetUserId: canSwitchUser ? effectiveUserId : undefined,
    }).then((response) => {
      const relevantEntries = response.entries.filter((entry) => mode !== "edit" || entry.id !== Number(entryId));
      setRangeEntryConflict({
        hasWork: relevantEntries.some((entry) => entry.entryType === "work"),
        hasLeave: relevantEntries.some((entry) => entry.entryType !== "work"),
      });
    }).catch(() => {
      setRangeEntryConflict({ hasWork: false, hasLeave: false });
    });
  }, [canSwitchUser, companySession, effectiveUserId, entryId, mode, resolvedEndDate, startDate]);

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
        setProjectId(response.entry.projectId ? String(response.entry.projectId) : "");
        setTaskId(response.entry.taskId ? String(response.entry.taskId) : "");
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
      setProjectId("");
      setTaskId("");
      return;
    }

    setEndDate(startDate);
  }, [entryType, startDate]);

  async function handleSave() {
    if (!companySession || !effectiveUserId) return;

    try {
      if (resolvedEndDate < startDate) throw new Error(t("recordEditor.endDateAfterStart"));
      if (blockingError) throw new Error(blockingError);
      if (entryType === "work") {
        if (!startTime) throw new Error(t("recordEditor.startTimeRequired"));
        if (!endTime) throw new Error(t("recordEditor.endTimeRequired"));
        if (settings.projectsEnabled && !projectId) throw new Error(t("recordEditor.projectRequired"));
        if (settings.tasksEnabled && !taskId) throw new Error(t("recordEditor.taskRequired"));
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
              projectId: projectId ? Number(projectId) : null,
              taskId: taskId ? Number(taskId) : null,
              customFieldValues,
            }
          : {
              entryType,
              startDate,
              endDate: resolvedEndDate,
              startTime: null,
              endTime: null,
              notes,
              projectId: null,
              taskId: null,
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
          <FormSection>
            <EntryTypeTabs value={entryType} onValueChange={setEntryType} items={entryTypeTabs} />
          </FormSection>

          <LeaveStateBars
            locale={settings.locale}
            entryType={entryType}
            vacation={vacationBalance}
            timeOffInLieu={timeOffInLieuBalance}
            sickLeave={{ usedDays: sickLeaveUsedDays, elapsedDays: sickLeaveElapsedDays }}
          />

          <FormSection>
            <FormFields>
              <EntryScheduleFields
                locale={settings.locale}
                timeZone={settings.timeZone}
                settings={settings}
                entryType={entryType}
                startDate={startDate}
                endDate={endDate}
                startTime={startTime}
                endTime={endTime}
                onStartDateChange={(value) => {
                  setStartDate(value);
                  if (entryType === "work") {
                    setEndDate((currentEndDate) => {
                      if (!currentEndDate || currentEndDate === startDate || currentEndDate < value) {
                        return value;
                      }

                      return currentEndDate;
                    });
                  }
                }}
                onEndDateChange={setEndDate}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                fromDateLabel={t("recordEditor.fromDate")}
                toDateLabel={t("recordEditor.toDate")}
                startTimeLabel={t("recordEditor.startTime")}
                endTimeLabel={t("recordEditor.endTime")}
              />
              {entryType === "work" && settings.projectsEnabled ? (
                <Field label={t("recordEditor.project")}>
                  <Combobox
                    value={projectId}
                    onValueChange={(value) => {
                      setProjectId(value);
                      setTaskId("");
                    }}
                    options={projectOptions}
                    placeholder={t("recordEditor.projectPlaceholder")}
                    searchPlaceholder={t("recordEditor.projectSearchPlaceholder")}
                    emptyText={t("recordEditor.noProjects")}
                    searchable
                  />
                </Field>
              ) : null}
              {entryType === "work" && settings.tasksEnabled ? (
                <Field label={t("recordEditor.task")}>
                  <Combobox
                    value={taskId}
                    onValueChange={setTaskId}
                    options={taskOptions}
                    placeholder={projectId ? t("recordEditor.taskPlaceholder") : t("recordEditor.selectProjectFirst")}
                    searchPlaceholder={t("recordEditor.taskSearchPlaceholder")}
                    emptyText={projectId ? t("recordEditor.noTasks") : t("recordEditor.selectProjectFirst")}
                    searchable
                    disabled={!projectId}
                  />
                </Field>
              ) : null}
              {activeCustomFields.map((field) => (
                <CustomFieldField
                  key={field.id}
                  field={field}
                  value={customFieldValues[field.id]}
                  locale={settings.locale}
                  onValueChange={(value) => setCustomFieldValue(field, value)}
                  booleanLabels={{ yes: t("recordEditor.yes"), no: t("recordEditor.no") }}
                />
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

          {blockingError ? (
            <p className="text-sm leading-6 text-destructive" aria-live="polite">
              {blockingError}
            </p>
          ) : null}

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
              <Button disabled={saving || loading || deleting || Boolean(blockingError)} onClick={() => void handleSave()} type="button">
                {saving ? t("recordEditor.saving") : mode === "create" ? t("recordEditor.addEntry") : t("recordEditor.save")}
              </Button>
            </div>
          </FormActions>
        </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
