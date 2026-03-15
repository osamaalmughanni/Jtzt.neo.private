import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PencilSimple, Plus, Trash } from "phosphor-react";
import type {
  CompanyCustomField,
  CompanySettings,
  CompanyUserListItem,
  DashboardSummary,
  TimeEntryView,
} from "@shared/types/models";
import {
  diffCalendarDays,
  formatLocalDay,
  parseLocalDay,
} from "@shared/utils/time";
import { formatMinutes } from "@shared/utils/time";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import {
  Field,
  FieldCombobox,
  FormPage,
  FormSection,
} from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { entryStateUi, getEntryTypeLabel } from "@/lib/entry-state-ui";
import { formatCompanyDate, formatCompanyDateRange } from "@/lib/locale-format";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: "en-GB",
  dateTimeFormat: "g",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  country: "AT",
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

function toTimeInputValue(isoValue: string | null) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function canManageOtherUsers(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function isToday(date: Date) {
  return date.toDateString() === new Date().toDateString();
}

function parseDayParam(value: string | null) {
  if (!value) return new Date();
  return parseLocalDay(value) ?? new Date();
}

function canBypassDayLimits(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function isDayWithinLimit(day: string, limit: number) {
  return diffCalendarDays(formatLocalDay(new Date()), day) <= limit;
}

function getEntryHeadline(entry: TimeEntryView) {
  if (entry.entryType === "work") {
    return `${toTimeInputValue(entry.startTime)} - ${toTimeInputValue(entry.endTime)}`;
  }

  return getEntryTypeLabel(entry.entryType);
}

function getEntryMeta(entry: TimeEntryView, locale: string) {
  if (entry.entryType === "work") {
    return formatMinutes(entry.durationMinutes);
  }

  return `${formatCompanyDateRange(entry.entryDate, entry.endDate, locale)} • ${entry.effectiveDayCount} day${entry.effectiveDayCount === 1 ? "" : "s"}`;
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

export function DashboardPage() {
  const { companySession, companyIdentity, isTabletMode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [entries, setEntries] = useState<TimeEntryView[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(defaultSummary);
  const [statsRange, setStatsRange] = useState<"day" | "week" | "month">("month");
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<TimeEntryView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
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
    isDayWithinLimit(selectedDayKey, settings.insertDaysLimit);
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

  async function loadEntries() {
    if (!companySession || !effectiveUserId) return;

    try {
      const [entriesResponse, dashboardResponse] = await Promise.all([
        api.listTimeEntries(companySession.token, {
          from: formatLocalDay(startOfDay(selectedDate)),
          to: formatLocalDay(endOfDay(selectedDate)),
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
        }),
        api.getDashboard(companySession.token, canSwitchUser ? effectiveUserId : undefined),
      ]);
      setEntries(entriesResponse.entries);
      setSummary(dashboardResponse.summary);
    } catch (error) {
      toast({
        title: "Could not load records",
        description: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  useEffect(() => {
    if (!companyIdentity?.user.id) return;
    const needsUser = !searchParams.get("user");
    const needsDay = !searchParams.get("day");
    if (!needsUser && !needsDay) return;

    const params = new URLSearchParams(searchParams);
    if (needsUser) params.set("user", String(companyIdentity.user.id));
    if (needsDay) params.set("day", formatLocalDay(new Date()));
    setSearchParams(params, { replace: true });
  }, [companyIdentity?.user.id, searchParams, setSearchParams]);

  useEffect(() => {
    if (!companySession) return;

    void api
      .getSettings(companySession.token)
      .then((response) => setSettings(response.settings))
      .catch(() => undefined);

    if (!canSwitchUser) {
      setUsers([]);
      return;
    }

    void api
      .listUsers(companySession.token)
      .then((response) => setUsers(response.users))
      .catch((error) => {
        if (companySession.accessMode === "tablet") {
          return;
        }
        toast({
          title: "Could not load users",
          description:
            error instanceof Error ? error.message : "Request failed",
        });
      });
  }, [canSwitchUser, companySession]);

  useEffect(() => {
    void loadEntries();
  }, [companySession, effectiveUserId, selectedDate]);

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
      toast({ title: "Record deleted" });
      await loadEntries();
    } catch (error) {
      toast({
        title: "Could not delete record",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const createRecordHref = `/dashboard/records/create?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
  const dayPickerHref = `/dashboard/day?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
  const userOptions = availableUsers.map((user) => ({
    value: String(user.id),
    label: user.fullName,
  }));
  return (
    <FormPage className="flex flex-col gap-5">
      {!isTabletMode ? (
        <AppConfirmDialog
          open={pendingDeleteEntry !== null}
          onOpenChange={(open) =>
            !open && !deleteSubmitting && setPendingDeleteEntry(null)
          }
          title="Delete record"
          description={
            pendingDeleteEntry
              ? pendingDeleteEntry.entryType === "work"
                ? `${toTimeInputValue(pendingDeleteEntry.startTime)} - ${toTimeInputValue(pendingDeleteEntry.endTime)} will be removed.`
                : `${getEntryTypeLabel(pendingDeleteEntry.entryType)} on ${formatCompanyDate(pendingDeleteEntry.entryDate, settings.locale)} will be removed.`
              : undefined
          }
          confirmLabel="Delete"
          destructive
          confirming={deleteSubmitting}
          onConfirm={() =>
            pendingDeleteEntry && void deleteEntry(pendingDeleteEntry.id)
          }
        />
      ) : null}
      <PageLabel
        title="Overview"
        description="Manage daily records and user context."
      />
      {canSwitchUser ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <FormSection>
            <Field label="Working as">
              <FieldCombobox
                label="user"
                value={effectiveUserId ? String(effectiveUserId) : ""}
                onValueChange={(value) =>
                  updateContext({ userId: Number(value) })
                }
                items={userOptions}
              />
            </Field>
          </FormSection>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{selectedUserName}</p>
              {isTabletMode ? (
                <p className="text-left text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  {selectedDate.toLocaleDateString(settings.locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
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
                <span>{formatMinutes(dayMinutes)} recorded</span>
                {summary.contractStats.currentContract ? (
                  <span>{summary.contractStats.currentContract.hoursPerWeek.toFixed(2)} h/week</span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="w-[5.5rem] text-right text-sm text-muted-foreground">
                {now.toLocaleTimeString(settings.locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
              <Button
                variant={isToday(selectedDate) ? "secondary" : "outline"}
                onClick={() => updateContext({ day: new Date() })}
                type="button"
              >
                Today
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-sm font-medium text-foreground">Balance</p>
                <p className="truncate text-sm text-muted-foreground">
                  Total {formatBalanceMinutes(summary.contractStats.totalBalanceMinutes)}
                </p>
              </div>
              <Button variant="ghost" onClick={cycleStatsRange} type="button" className="h-8 px-3 text-xs">
                {statsRange === "month" ? "Month" : statsRange === "week" ? "Week" : "Day"}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                Expected {formatMinutes(activeContractStats.expectedMinutes)}
              </Badge>
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                Recorded {formatMinutes(activeContractStats.recordedMinutes)}
              </Badge>
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-xs font-medium">
                Balance {formatBalanceMinutes(activeContractStats.balanceMinutes)}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <div>
          <p className="text-sm font-medium text-foreground">Records</p>
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {entries.map((entry) => {
              const canEdit =
                bypassDayLimits ||
                isDayWithinLimit(entry.entryDate, settings.editDaysLimit);
              const editHref = `/dashboard/records/${entry.id}/edit?user=${effectiveUserId ?? ""}&day=${formatLocalDay(selectedDate)}`;
              const supportText = getEntrySupportText(
                entry,
                customFieldsById,
              );

              return (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/70 last:border-b-0"
                >
                  <div className="grid min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${entryStateUi[entry.entryType].dotClassName}`}
                      />
                      <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium leading-none text-foreground">
                        {getEntryHeadline(entry)}
                      </div>
                    </div>
                    <span className="min-w-0 truncate whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs font-medium leading-none text-foreground">
                      {getEntryMeta(entry, settings.locale)}
                    </span>
                    {supportText ? (
                      <div className="min-w-0 truncate whitespace-nowrap text-sm leading-none text-muted-foreground">
                        {supportText}
                      </div>
                    ) : (
                      <div className="min-w-0" />
                    )}
                  </div>
                  {!isTabletMode ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingDeleteEntry(entry)}
                        type="button"
                        aria-label="Delete record"
                      >
                        <Trash size={16} weight="bold" />
                      </Button>
                      {canEdit ? (
                        <Button asChild size="icon" variant="ghost">
                          <Link to={editHref} aria-label="Edit record">
                            <PencilSimple size={16} weight="bold" />
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          disabled
                          size="icon"
                          variant="ghost"
                          type="button"
                          aria-label="Record locked"
                        >
                          <PencilSimple size={16} weight="bold" />
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No records for this day
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        {canCreateRecord ? (
          <Button
            asChild
            className="h-20 w-20 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
            size="icon"
            type="button"
          >
            <Link to={createRecordHref} aria-label="Add record">
              <Plus size={30} weight="bold" />
            </Link>
          </Button>
        ) : (
          <Button
            disabled
            className="h-20 w-20 rounded-full bg-primary text-primary-foreground shadow-lg"
            size="icon"
            type="button"
            aria-label="Add record unavailable"
          >
            <Plus size={30} weight="bold" />
          </Button>
        )}
      </div>
      {!canCreateRecord ? (
        <p className="text-center text-sm text-muted-foreground">
          Employees can only add records within the insert day limit.
        </p>
      ) : null}
    </FormPage>
  );
}
