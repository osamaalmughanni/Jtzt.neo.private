import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ReportResponse } from "@shared/types/api";
import type { CompanySettings } from "@shared/types/models";
import { diffCalendarDays, enumerateLocalDays, formatMinutes, parseLocalDay } from "@shared/utils/time";
import { AppFullBleed } from "@/components/app-content-lane";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { formatCompanyDate, formatCompanyDateTime } from "@/lib/locale-format";
import { normalizeReportDraftFields } from "@/lib/report-fields";
import { exportReportExcel, exportReportPdf } from "@/lib/report-export";
import { loadReportDraft } from "@/lib/report-draft-storage";
import { toast } from "@/lib/toast";

const TIMELINE_DAY_WIDTH = 56;
const GANTT_LEFT_COLUMN_WIDTH = 272;
const GANTT_ROW_HEIGHT = 108;
const GANTT_LANE_HEIGHT = 18;
const GANTT_MAX_LANES = 3;

function isLocalDayValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function translateEntryType(value: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (value) {
    case "work":
    case "Working":
      return t("recordEditor.working");
    case "vacation":
    case "Vacation":
      return t("recordEditor.vacation");
    case "time_off_in_lieu":
    case "Time off in lieu":
      return t("recordEditor.timeOffInLieu");
    case "sick_leave":
    case "Sick leave":
      return t("recordEditor.sickLeave");
    default:
      return value;
  }
}

function formatCellValue(
  value: string | number | null,
  columnKey: string,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  timeZone: string,
  dateTimeFormat: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (value === null || value === "") return "--";
  if (columnKey === "type" && typeof value === "string") return translateEntryType(value, t);
  if (kind === "duration" && typeof value === "number") return formatMinutes(value);
  if (kind === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
  if (kind === "date" && typeof value === "string") return formatCompanyDate(value, locale);
  if (kind === "datetime" && typeof value === "string" && isLocalDayValue(value)) return formatCompanyDate(value, locale);
  if (kind === "datetime" && typeof value === "string") return formatCompanyDateTime(value, locale, dateTimeFormat, timeZone);
  if (kind === "number" && typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

function formatDecimalHours(minutes: number) {
  return `${(minutes / 60).toFixed(1)}h`;
}

function getOvertimeSegmentClass(kind: "base" | "standard_overtime" | "employee_choice" | "break") {
  if (kind === "base") return "bg-sky-500";
  if (kind === "standard_overtime") return "bg-[repeating-linear-gradient(135deg,#7c3aed_0px,#7c3aed_7px,#a78bfa_7px,#a78bfa_14px)]";
  if (kind === "employee_choice") return "bg-orange-500";
  return "";
}

function getOvertimeLegendDotClass(kind: "base" | "standard_overtime" | "employee_choice" | "break") {
  if (kind === "base") return "bg-sky-500";
  if (kind === "standard_overtime") return "bg-violet-500";
  if (kind === "employee_choice") return "bg-orange-500";
  return "";
}

function getOvertimeSegmentStyle(kind: "base" | "standard_overtime" | "employee_choice" | "break") {
  if (kind !== "break") return undefined;
  return { backgroundColor: "#ef4444" };
}

function getOvertimeLegendDotStyle(kind: "base" | "standard_overtime" | "employee_choice" | "break") {
  if (kind !== "break") return undefined;
  return { backgroundColor: "#ef4444" };
}

function OvertimeStateBadge({ meta }: { meta: NonNullable<ReportResponse["report"]["rowMeta"][number]["overtime"]> }) {
  const className = meta.reviewState === "needs_review"
    ? "border-0 bg-destructive text-destructive-foreground"
    : meta.state === "employee_choice"
      ? "border border-border bg-accent text-accent-foreground"
      : meta.state === "weekly_overtime"
        ? "border border-border bg-secondary text-secondary-foreground"
        : meta.state === "daily_overtime"
          ? "border border-border bg-secondary text-secondary-foreground"
          : "border border-border bg-muted text-foreground";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{meta.stateLabel}</span>;
}

function OvertimeTimelineCell({ meta }: { meta: NonNullable<ReportResponse["report"]["rowMeta"][number]["overtime"]> }) {
  const totalMinutes = Math.max(meta.workedMinutes, meta.segments.reduce((sum, segment) => sum + segment.minutes, 0));
  if (totalMinutes <= 0) {
    return <span className="text-muted-foreground">--</span>;
  }

  return (
    <div className="flex min-w-[16rem] flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {meta.segments.map((segment, index) => (
          <div
            key={`${segment.kind}-${index}`}
            className={getOvertimeSegmentClass(segment.kind)}
            style={{ width: `${(segment.minutes / totalMinutes) * 100}%`, ...getOvertimeSegmentStyle(segment.kind) }}
            title={`${segment.label}: ${formatDecimalHours(segment.minutes)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {meta.segments.map((segment, index) => (
          <span key={`${segment.kind}-legend-${index}`} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${getOvertimeLegendDotClass(segment.kind)}`} style={getOvertimeLegendDotStyle(segment.kind)} />
            <span>{segment.label} {formatDecimalHours(segment.minutes)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function OvertimeSummaryCell({ meta }: { meta: NonNullable<ReportResponse["report"]["rowMeta"][number]["overtime"]> }) {
  const rows = [
    { label: "Target", value: formatDecimalHours(meta.targetMinutes) },
    { label: "Actual", value: formatDecimalHours(meta.paidMinutes) },
    { label: "Premium", value: meta.overtimeMinutes > 0 ? `+${meta.premiumPercent}%` : "--" },
    { label: "Premium credit", value: meta.overtimeMinutes > 0 ? formatDecimalHours(meta.premiumCreditMinutes) : "--" },
    { label: "Time-off credit", value: meta.overtimeMinutes > 0 ? formatDecimalHours(meta.timeOffInLieuCreditMinutes) : "--" },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-xl border border-border bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{row.label}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function getOvertimeRowTitle(
  row: Record<string, string | number | null>,
  fallbackIndex: number,
  report: ReportResponse["report"],
) {
  const user = typeof row.user === "string" && row.user.trim().length > 0 ? row.user : `Row ${fallbackIndex + 1}`;
  const date = typeof row.date === "string" ? formatCompanyDate(row.date, report.locale) : null;
  const type = typeof row.type === "string" ? row.type : null;
  return [user, date, type].filter(Boolean).join(" - ");
}

function OvertimePreviewCard({
  row,
  meta,
  index,
  report,
}: {
  row: Record<string, string | number | null>;
  meta: NonNullable<ReportResponse["report"]["rowMeta"][number]["overtime"]>;
  index: number;
  report: ReportResponse["report"];
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">{getOvertimeRowTitle(row, index, report)}</p>
            <p className="text-sm text-muted-foreground">{meta.summary}</p>
          </div>
          <OvertimeStateBadge meta={meta} />
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-muted/30 p-3">
          <OvertimeTimelineCell meta={meta} />
        </div>
      </div>
      <OvertimeSummaryCell meta={meta} />
    </div>
  );
}

function formatDayAmount(value: number) {
  return `${value.toFixed(2)}d`;
}

function listDays(startDate: string, endDate: string) {
  return enumerateLocalDays(startDate, endDate);
}

function getDayDiff(startDate: string, endDate: string) {
  const start = parseLocalDay(startDate)?.getTime() ?? 0;
  const end = parseLocalDay(endDate)?.getTime() ?? 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function getMinuteOffset(timeValue: string | null) {
  if (!timeValue) return 0;
  const parsed = new Date(timeValue);
  if (Number.isNaN(parsed.getTime())) {
    const match = timeValue.match(/T(\d{2}):(\d{2})|^(\d{2}):(\d{2})/);
    if (!match) return 0;
    const hour = Number(match[1] ?? match[3] ?? 0);
    const minute = Number(match[2] ?? match[4] ?? 0);
    return hour * 60 + minute;
  }

  return parsed.getHours() * 60 + parsed.getMinutes();
}

function addDays(day: string, amount: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  parsed.setDate(parsed.getDate() + amount);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const date = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${date}`;
}

function aggregateTimelineItems(items: ReportResponse["report"]["timeline"]) {
  const sorted = [...items].sort((left, right) => {
    const leftKey = `${left.startDate}-${left.startTime ?? "00:00"}-${left.entryId}`;
    const rightKey = `${right.startDate}-${right.startTime ?? "00:00"}-${right.entryId}`;
    return leftKey.localeCompare(rightKey);
  });

  const grouped: ReportResponse["report"]["timeline"] = [];

  for (const item of sorted) {
    const previous = grouped[grouped.length - 1];
    const touchesPrevious =
      previous &&
      previous.entryType === item.entryType &&
      diffCalendarDays(item.startDate, addDays(previous.endDate, 1)) <= 0;

    if (!touchesPrevious) {
      grouped.push({ ...item });
      continue;
    }

    previous.endDate = item.endDate > previous.endDate ? item.endDate : previous.endDate;
    if (previous.entryType === "work") {
      previous.startTime = previous.startTime && item.startTime && previous.startDate === item.startDate
        ? (previous.startTime < item.startTime ? previous.startTime : item.startTime)
        : previous.startTime;
      previous.endTime = previous.endTime && item.endTime && previous.endDate === item.endDate
        ? (previous.endTime > item.endTime ? previous.endTime : item.endTime)
        : previous.endTime;
    } else {
      previous.startTime = null;
      previous.endTime = null;
    }
  }

  return grouped;
}

function formatTimelineTime(timeValue: string | null, locale: string, dateTimeFormat: string, timeZone: string) {
  if (!timeValue) return null;
  try {
    return new Intl.DateTimeFormat(locale || "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(timeValue));
  } catch {
    return formatCompanyDateTime(timeValue, locale, dateTimeFormat, timeZone);
  }
}

function buildTimelineMonthSegments(days: string[], locale: string) {
  const segments: Array<{ key: string; label: string; startIndex: number; dayCount: number }> = [];

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const parsed = parseLocalDay(day);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.getFullYear()}-${parsed.getMonth()}`;
    const label = new Intl.DateTimeFormat(locale || "en-GB", {
      month: "short",
      year: "numeric",
    }).format(parsed);
    const previous = segments[segments.length - 1];

    if (previous && previous.key === key) {
      previous.dayCount += 1;
      continue;
    }

    segments.push({
      key,
      label,
      startIndex: index,
      dayCount: 1,
    });
  }

  return segments;
}

function getTimelinePlacement(
  item: ReportResponse["report"]["timeline"][number],
  report: ReportResponse["report"],
) {
  const dayStartOffset = getDayDiff(report.startDate, item.startDate);
  const endDayOffset = getDayDiff(report.startDate, item.endDate);
  const startMinute = item.entryType === "work" ? getMinuteOffset(item.startTime) : 0;
  const endMinute = item.entryType === "work" ? Math.max(startMinute + 15, getMinuteOffset(item.endTime)) : 24 * 60;
  const startPosition = dayStartOffset + startMinute / 1440;
  const endPosition = endDayOffset + endMinute / 1440;
  const widthUnits = Math.max(endPosition - startPosition, item.entryType === "work" ? 0.18 : 1);

  return {
    leftUnits: startPosition,
    widthUnits,
    startPosition,
    endPosition: startPosition + widthUnits,
  };
}

function buildTimelineLanes(
  items: ReportResponse["report"]["timeline"],
  report: ReportResponse["report"],
) {
  const sortedItems = [...items].sort((left, right) => {
    const leftPlacement = getTimelinePlacement(left, report);
    const rightPlacement = getTimelinePlacement(right, report);
    if (leftPlacement.startPosition !== rightPlacement.startPosition) {
      return leftPlacement.startPosition - rightPlacement.startPosition;
    }
    return leftPlacement.endPosition - rightPlacement.endPosition;
  });

  const lanes: Array<Array<{ item: ReportResponse["report"]["timeline"][number]; leftUnits: number; widthUnits: number; endPosition: number }>> = [];

  for (const item of sortedItems) {
    const placement = getTimelinePlacement(item, report);
    let laneIndex = lanes.findIndex((lane) => {
      const last = lane[lane.length - 1];
      return !last || last.endPosition <= placement.startPosition;
    });

    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push([]);
    }

    lanes[laneIndex].push({
      item,
      leftUnits: placement.leftUnits,
      widthUnits: placement.widthUnits,
      endPosition: placement.endPosition,
    });
  }

  return lanes;
}

function buildCondensedTimelineRows(
  items: ReportResponse["report"]["timeline"],
  report: ReportResponse["report"],
) {
  const lanes = buildTimelineLanes(items, report);
  return {
    lanes: lanes.slice(0, GANTT_MAX_LANES),
    hiddenItemCount: lanes.slice(GANTT_MAX_LANES).reduce((sum, lane) => sum + lane.length, 0),
    totalLaneCount: lanes.length,
  };
}

function getTimelineItemLabel(item: ReportResponse["report"]["timeline"][number], report: ReportResponse["report"]) {
  if (item.entryType === "work" && item.startDate === item.endDate) {
    const startLabel = formatTimelineTime(item.startTime, report.locale, report.dateTimeFormat, report.timeZone);
    const endLabel = formatTimelineTime(item.endTime, report.locale, report.dateTimeFormat, report.timeZone);
    return [startLabel, endLabel].filter(Boolean).join(" - ");
  }

  if (item.startDate === item.endDate) {
    return formatCompanyDate(item.startDate, report.locale);
  }

  return `${formatCompanyDate(item.startDate, report.locale)} - ${formatCompanyDate(item.endDate, report.locale)}`;
}

export function ReportsPreviewPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const [searchParams] = useSearchParams();
  const { companySession } = useAuth();
  const draftId = searchParams.get("draft");
  const draft = useMemo(() => loadReportDraft(draftId), [draftId]);
  const [viewMode, setViewMode] = useState<"table" | "gantt" | "overtime" | "vacation">("table");
  const reportResource = usePageResource<{ report: ReportResponse["report"] | null; settings: CompanySettings | null }>({
    enabled: Boolean(companySession) && Boolean(draft),
    deps: [companySession?.token, draft, t],
    load: async () => {
      if (!companySession || !draft) {
        return { report: null, settings: null };
      }

      try {
        const settingsResponse = await api.getSettings(companySession.token);
        const normalizedDraft = {
          ...draft,
          ...normalizeReportDraftFields(draft, settingsResponse.settings),
        };
        const reportResponse = await api.previewReport(companySession.token, normalizedDraft);
        return {
          settings: settingsResponse.settings,
          report: reportResponse.report,
        };
      } catch (error) {
        toast({
          title: t("reports.createFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    }
  });
  const report = reportResource.data?.report ?? null;
  const settings = reportResource.data?.settings ?? null;

  const backTo = `/reports${draftId ? `?draft=${draftId}` : ""}`;
  const timelineDays = useMemo(() => (report ? listDays(report.startDate, report.endDate) : []), [report]);
  const timelineMonths = useMemo(() => buildTimelineMonthSegments(timelineDays, report?.locale ?? "en-GB"), [report?.locale, timelineDays]);
  const timelineWidth = timelineDays.length * TIMELINE_DAY_WIDTH;
  const resolvedColumns = useMemo(() => report?.columns ?? [], [report?.columns]);
  const timelineUsers = useMemo(() => {
    if (!report) return [];
    const groupedByUser = new Map<
      number,
      {
        userId: number;
        userName: string;
        role: string;
        items: ReportResponse["report"]["timeline"];
      }
    >();

    for (const item of report.timeline) {
      const current = groupedByUser.get(item.userId) ?? {
        userId: item.userId,
        userName: item.userName,
        role: item.role,
        items: [],
      };
      current.items.push(item);
      groupedByUser.set(item.userId, current);
    }

    return Array.from(groupedByUser.values()).map((user) => ({
      ...user,
      items: aggregateTimelineItems(user.items),
    }));
  }, [report]);
  const virtualGanttRows = useMemo(() => {
    if (!report) return [];
    return timelineUsers.map((user) => ({
      ...user,
      condensed: buildCondensedTimelineRows(user.items, report),
    }));
  }, [report, timelineUsers]);

  const rowsWithMeta = useMemo(() => {
    if (!report) return [];
    return report.rows.map((row, index) => ({
      row,
      meta: report.rowMeta[index] ?? { entryId: null, userId: null, overtime: null },
      index,
    }));
  }, [report]);
  const overtimePreviewRows = useMemo(
    () => rowsWithMeta.filter((item) => item.meta.overtime !== null),
    [rowsWithMeta],
  );
  const vacationOverviewRows = useMemo(() => report?.vacationOverview ?? [], [report]);
  const vacationTotals = useMemo(
    () => ({
      users: vacationOverviewRows.length,
      periods: vacationOverviewRows.reduce((sum, row) => sum + row.periods.length, 0),
      days: vacationOverviewRows.reduce((sum, row) => sum + row.usedDays, 0),
    }),
    [vacationOverviewRows],
  );

  useEffect(() => {
    if (!draft && !reportResource.isLoading) {
      navigate("/reports", { replace: true });
    }
  }, [draft, navigate, reportResource.isLoading]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  return (
    <FormPage className="h-full min-h-0">
      <PageLoadBoundary
        className="min-h-0 flex-1"
        intro={
          <>
            <PageBackAction to={backTo} label={t("reports.backToReports")} />
            <PageIntro>
              <PageLabel title={t("reports.previewTitle")} description={t("reports.previewDescription")} />
            </PageIntro>
          </>
        }
        loading={reportResource.isLoading}
        refreshing={reportResource.isRefreshing}
        gap="lg"
        skeleton={<PageLoadingState label={t("reports.creating")} minHeightClassName="min-h-[28rem]" />}
      >
        <AppFullBleed className="flex min-h-0 flex-1 min-w-0 xl:px-12 2xl:px-16">
          <FormPanel className="flex h-full min-h-0 min-w-0 w-full flex-col gap-5 overflow-hidden">
            {report ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.period")}</p>
                    <p className="text-sm font-medium text-foreground">
                      {formatCompanyDate(report.startDate, report.locale)} to {formatCompanyDate(report.endDate, report.locale)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.entries")}</p>
                    <p className="text-sm font-medium text-foreground">{report.totals.entryCount}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.hours")}</p>
                    <p className="text-sm font-medium text-foreground">{formatMinutes(report.totals.durationMinutes)}</p>
                  </div>
                </div>

                <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "table" | "gantt" | "overtime" | "vacation")} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <TabsList className="h-9">
                      <TabsTrigger value="table">{t("reports.table")}</TabsTrigger>
                      <TabsTrigger value="gantt">{t("reports.gantt")}</TabsTrigger>
                      <TabsTrigger value="overtime">{t("reports.overtimeTab")}</TabsTrigger>
                      <TabsTrigger value="vacation">{t("reports.vacationTab")}</TabsTrigger>
                    </TabsList>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => exportReportExcel({ ...report, columns: resolvedColumns }, t)} type="button">
                        {t("reports.exportExcel")}
                      </Button>
                      <Button variant="outline" onClick={() => exportReportPdf({ ...report, columns: resolvedColumns }, t)} type="button">
                        {t("reports.exportPdf")}
                      </Button>
                    </div>
                  </div>

                  <TabsContent value="table" className="mt-0 min-h-0 min-w-0 flex-1 overflow-hidden">
                    <div className="h-full w-full min-w-0 overflow-auto rounded-2xl border border-border">
                      <table className="w-max min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            {resolvedColumns.map((column) => (
                              <th key={column.key} className="whitespace-nowrap px-4 py-3 text-left font-medium text-foreground">
                                {column.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rowsWithMeta.map(({ row, meta }, index) => (
                            <tr key={index} className="border-b border-border/70 last:border-b-0">
                              {resolvedColumns.map((column) => (
                                <td key={column.key} className="px-4 py-3 text-muted-foreground align-top">
                                  {column.kind === "overtime_state" && meta.overtime ? (
                                    <OvertimeStateBadge meta={meta.overtime} />
                                  ) : column.kind === "overtime_timeline" && meta.overtime ? (
                                    <OvertimeTimelineCell meta={meta.overtime} />
                                  ) : (
                                    <span className="whitespace-nowrap">
                                      {formatCellValue(
                                        row[column.key] ?? null,
                                        column.key,
                                        column.kind,
                                        report.locale,
                                        report.currency,
                                        report.timeZone,
                                        report.dateTimeFormat,
                                        t,
                                      )}
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>

                  <TabsContent value="gantt" className="mt-0 min-h-0 flex-1 overflow-hidden">
                    <div className="flex h-full w-full min-h-0 flex-col gap-4 rounded-2xl border border-border p-4">
                      <p className="text-sm text-muted-foreground">Responsive timeline with condensed lanes for readable large reports.</p>
                      {timelineUsers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("reports.noTimeline")}</p>
                      ) : (
                        <div className="min-h-0 w-full flex-1 overflow-auto rounded-2xl border border-border bg-background">
                          <div
                            className="relative"
                            style={{ minWidth: GANTT_LEFT_COLUMN_WIDTH + timelineWidth }}
                          >
                            <div className="flex overflow-hidden border-b border-border bg-background">
                              <div
                                className="flex h-12 shrink-0 items-center border-r border-border bg-background px-4"
                                style={{ width: GANTT_LEFT_COLUMN_WIDTH }}
                              >
                                <span className="text-sm font-medium text-foreground">Users</span>
                              </div>
                              <div className="relative h-12 shrink-0 overflow-hidden" style={{ width: timelineWidth }}>
                                {timelineMonths.map((segment) => (
                                  <div
                                    key={segment.key}
                                    className="absolute top-0 flex h-12 items-center border-r border-border/60 px-3 text-sm font-medium text-foreground"
                                    style={{
                                      left: segment.startIndex * TIMELINE_DAY_WIDTH,
                                      width: segment.dayCount * TIMELINE_DAY_WIDTH,
                                    }}
                                  >
                                    <span className="truncate">{segment.label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex flex-col">
                              {virtualGanttRows.map((user) => {
                                return (
                                  <div
                                    key={user.userId}
                                    className="flex border-b border-border"
                                    style={{ minHeight: GANTT_ROW_HEIGHT, width: GANTT_LEFT_COLUMN_WIDTH + timelineWidth }}
                                  >
                                    <div className="flex shrink-0 flex-col justify-center gap-2 border-r border-border bg-background px-4 py-4" style={{ width: GANTT_LEFT_COLUMN_WIDTH }}>
                                      <div className="flex flex-col gap-1">
                                        <p className="truncate text-sm font-medium text-foreground">{user.userName}</p>
                                        <p className="text-xs text-muted-foreground">{user.role}</p>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                        {(["work", "vacation", "time_off_in_lieu", "sick_leave"] as const)
                                          .filter((type) => user.items.some((item) => item.entryType === type))
                                          .map((type) => (
                                            <span key={`${user.userId}-${type}-legend`} className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1">
                                              <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi[type].dotClassName}`} />
                                              <span>
                                                {type === "work"
                                                  ? t("reports.workRow")
                                                  : type === "vacation"
                                                    ? t("reports.vacationRow")
                                                    : type === "time_off_in_lieu"
                                                      ? t("reports.timeOffInLieuRow")
                                                    : t("reports.sickLeaveRow")}
                                              </span>
                                            </span>
                                          ))}
                                        {user.condensed.hiddenItemCount > 0 ? (
                                          <span className="inline-flex items-center rounded-full bg-foreground px-2.5 py-1 text-xs text-background">
                                            +{user.condensed.hiddenItemCount} more
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div
                                      className="relative shrink-0 py-4"
                                      style={{
                                        width: timelineWidth,
                                        backgroundColor: "hsl(var(--muted) / 0.18)",
                                        backgroundImage: `
                                          linear-gradient(to right, hsl(var(--border) / 0.55) 0, hsl(var(--border) / 0.55) 1px, transparent 1px),
                                          linear-gradient(to bottom, hsl(var(--border) / 0.2), hsl(var(--border) / 0.2))
                                        `,
                                        backgroundSize: `${TIMELINE_DAY_WIDTH}px 100%, 100% 100%`,
                                      }}
                                    >
                                      <div className="flex flex-col gap-1.5 px-2">
                                        {user.condensed.lanes.map((lane, laneIndex) => (
                                          <div
                                            key={`${user.userId}-lane-${laneIndex}`}
                                            className="relative rounded-md"
                                            style={{ height: GANTT_LANE_HEIGHT }}
                                          >
                                            {lane.map(({ item, leftUnits, widthUnits }) => {
                                              const label = getTimelineItemLabel(item, report);
                                              return (
                                                <div
                                                  key={item.entryId}
                                                  className={`absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium text-foreground shadow-sm ${entryStateUi[item.entryType].badgeClassName}`}
                                                  style={{
                                                    left: leftUnits * TIMELINE_DAY_WIDTH,
                                                    width: Math.max(widthUnits * TIMELINE_DAY_WIDTH, 44),
                                                  }}
                                                  title={`${item.userName} / ${label}`}
                                                >
                                                  <span className="truncate">{label}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ))}
                                        {user.condensed.totalLaneCount === 0 ? (
                                          <div className="flex h-full items-center px-2 text-xs text-muted-foreground">No entries</div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="overtime" className="mt-0 min-h-0 flex-1 overflow-hidden">
                    <div className="flex h-full w-full min-h-0 flex-col gap-4 rounded-2xl border border-border p-4">
                      {overtimePreviewRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("reports.noOvertimePreview")}</p>
                      ) : (
                        <div className="min-h-0 flex-1 overflow-auto">
                          <div className="flex flex-col gap-4">
                          {overtimePreviewRows.map(({ row, meta, index }) =>
                            meta.overtime ? (
                              <OvertimePreviewCard
                                key={`overtime-preview-${index}`}
                                row={row}
                                meta={meta.overtime}
                                index={index}
                                report={report}
                              />
                            ) : null,
                          )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="vacation" className="mt-0 min-h-0 flex-1 overflow-hidden">
                    <div className="flex h-full w-full min-h-0 flex-col gap-4 rounded-2xl border border-border p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-border bg-background p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationUsers")}</p>
                          <p className="text-sm font-medium text-foreground">{vacationTotals.users}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationPeriods")}</p>
                          <p className="text-sm font-medium text-foreground">{vacationTotals.periods}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationDays")}</p>
                          <p className="text-sm font-medium text-foreground">{vacationTotals.days}</p>
                        </div>
                      </div>
                      {vacationOverviewRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("reports.noVacationPreview")}</p>
                      ) : (
                        <div className="min-h-0 flex-1 overflow-auto">
                          <div className="flex flex-col gap-4">
                            {vacationOverviewRows.map((row) => (
                              <div key={`vacation-${row.userId}`} className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="flex flex-col gap-1">
                                    <p className="text-sm font-medium text-foreground">{row.userName}</p>
                                    <p className="text-xs text-muted-foreground">{row.role}</p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-foreground">
                                      {t("reports.vacationDaysBadge", { value: row.usedDays })}
                                    </span>
                                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-foreground">
                                      {t("reports.vacationPeriodsBadge", { value: row.periods.length })}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {row.monthBreakdown.map((month) => (
                                    <span key={`${row.userId}-${month.label}`} className="rounded-full bg-muted px-2.5 py-1">
                                      {month.label} • {month.days}d
                                    </span>
                                  ))}
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationAvailable")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">{formatDayAmount(row.availableDays)}</p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationUsed")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">{formatDayAmount(row.usedDays)}</p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationEntitlement")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">{formatDayAmount(row.entitledDays)}</p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationContractAllowance")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">
                                      {row.currentContractVacationDays === null ? "--" : formatDayAmount(row.currentContractVacationDays)}
                                    </p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationWorkYear")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">
                                      {row.currentWorkYearStart && row.currentWorkYearEnd
                                        ? `${formatCompanyDate(row.currentWorkYearStart, report.locale)} to ${formatCompanyDate(row.currentWorkYearEnd, report.locale)}`
                                        : "--"}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationNextGrant")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">
                                      {row.nextFullEntitlementDate ? formatCompanyDate(row.nextFullEntitlementDate, report.locale) : "--"}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("reports.vacationStatus")}</p>
                                    <p className="mt-1 text-sm font-medium text-foreground">
                                      {row.inInitialAccrualPhase ? t("reports.vacationAccrualPhase") : t("reports.vacationFullEntitlement")}
                                    </p>
                                  </div>
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border">
                                  <table className="w-full border-collapse text-sm">
                                    <thead>
                                      <tr className="border-b border-border bg-muted/40">
                                        <th className="px-4 py-3 text-left font-medium text-foreground">{t("reports.period")}</th>
                                        <th className="px-4 py-3 text-left font-medium text-foreground">{t("reports.vacationDays")}</th>
                                        <th className="px-4 py-3 text-left font-medium text-foreground">{t("reports.note")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.periods.map((period) => (
                                        <tr key={period.entryId} className="border-b border-border/70 last:border-b-0">
                                          <td className="px-4 py-3 text-muted-foreground">
                                            {formatCompanyDate(period.startDate, report.locale)} to {formatCompanyDate(period.endDate, report.locale)}
                                          </td>
                                          <td className="px-4 py-3 text-muted-foreground">{period.days}</td>
                                          <td className="px-4 py-3 text-muted-foreground">{period.notes?.trim() || "--"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            ) : null}
          </FormPanel>
        </AppFullBleed>
      </PageLoadBoundary>
    </FormPage>
  );
}
