import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ReportResponse } from "@shared/types/api";
import type { CompanySettings } from "@shared/types/models";
import { diffCalendarDays, enumerateLocalDays, formatMinutes, parseLocalDay } from "@shared/utils/time";
import { FormPage, FormPanel } from "@/components/form-layout";
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
import { buildCustomFieldLabelLookup, normalizeReportDraftFields, resolveCustomFieldLabel } from "@/lib/report-fields";
import { exportReportExcel, exportReportPdf } from "@/lib/report-export";
import { loadReportDraft } from "@/lib/report-draft-storage";
import { toast } from "@/lib/toast";

function isLocalDayValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const TIMELINE_DAY_WIDTH = 56;

function getReportColumnLabel(
  column: ReportResponse["report"]["columns"][number],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const nativeKey = `reports.columns.${column.key}`;
  const translated = t(nativeKey);
  return translated === nativeKey ? column.label : translated;
}

function getResolvedReportColumnLabel(
  column: ReportResponse["report"]["columns"][number],
  t: ReturnType<typeof useTranslation>["t"],
  customFieldLabels: Map<string, string>,
) {
  const nativeLabel = getReportColumnLabel(column, t);
  if (nativeLabel !== column.label) return nativeLabel;
  const customLabel = resolveCustomFieldLabel(column.key, customFieldLabels) ?? resolveCustomFieldLabel(column.label, customFieldLabels);
  if (customLabel) return customLabel;
  return column.label;
}

function resolveReportColumnsWithSettings(
  columns: ReportResponse["report"]["columns"],
  customFieldLabels: Map<string, string>,
) {
  return columns.map((column) => ({
    ...column,
    label: resolveCustomFieldLabel(column.key, customFieldLabels) ?? resolveCustomFieldLabel(column.label, customFieldLabels) ?? column.label,
  }));
}

function translateEntryType(value: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (value) {
    case "work":
    case "Working":
      return t("recordEditor.working");
    case "vacation":
    case "Vacation":
      return t("recordEditor.vacation");
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
  const [viewMode, setViewMode] = useState<"table" | "gantt">("table");
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
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
        const customFieldLabels = buildCustomFieldLabelLookup(settingsResponse.settings.customFields);
        return {
          settings: settingsResponse.settings,
          report: {
            ...reportResponse.report,
            columns: resolveReportColumnsWithSettings(reportResponse.report.columns, customFieldLabels),
          }
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
  const customFieldLabels = useMemo(() => buildCustomFieldLabelLookup(settings?.customFields ?? []), [settings?.customFields]);
  const resolvedColumns = useMemo(
    () =>
      report?.columns.map((column) => ({
        ...column,
        label: getResolvedReportColumnLabel(column, t, customFieldLabels),
      })) ?? [],
    [customFieldLabels, report?.columns, t],
  );
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

  useEffect(() => {
    if (!draft && !reportResource.isLoading) {
      navigate("/reports", { replace: true });
    }
  }, [draft, navigate, reportResource.isLoading]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    if (viewMode !== "gantt") return;
    const node = timelineScrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => undefined);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [viewMode, timelineWidth]);

  return (
    <FormPage className="w-full">
      <PageBackAction to={backTo} label={t("reports.backToReports")} />
      <PageLabel title={t("reports.previewTitle")} description={t("reports.previewDescription")} />
      <div
        className="relative left-1/2 w-full -translate-x-1/2 px-5 sm:px-8 lg:px-10"
        style={{ width: "min(120rem, calc(100vw - 2rem))" }}
      >
        <PageLoadBoundary
        loading={reportResource.isLoading}
        refreshing={reportResource.isRefreshing}
        overlayLabel={t("reports.creating")}
          skeleton={<PageLoadingState label={t("reports.creating")} minHeightClassName="min-h-[28rem]" />}
        >
          <FormPanel className="flex w-full flex-col gap-6">
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

              <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "table" | "gantt")} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <TabsList className="h-9">
                    <TabsTrigger value="table">{t("reports.table")}</TabsTrigger>
                    <TabsTrigger value="gantt">{t("reports.gantt")}</TabsTrigger>
                  </TabsList>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => exportReportExcel({ ...report, columns: resolvedColumns }, t, customFieldLabels)} type="button">
                      {t("reports.exportExcel")}
                    </Button>
                    <Button variant="outline" onClick={() => exportReportPdf({ ...report, columns: resolvedColumns }, t, customFieldLabels)} type="button">
                      {t("reports.exportPdf")}
                    </Button>
                  </div>
                </div>

                <TabsContent value="table" className="mt-0">
                  <div className="w-full overflow-auto rounded-2xl border border-border">
                    <table className="min-w-full border-collapse text-sm">
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
                        {report.rows.map((row, index) => (
                          <tr key={index} className="border-b border-border/70 last:border-b-0">
                            {resolvedColumns.map((column) => (
                              <td key={column.key} className="whitespace-nowrap px-4 py-3 text-muted-foreground">
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
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                <TabsContent value="gantt" className="mt-0">
                  <div className="flex w-full flex-col gap-4 rounded-2xl border border-border p-4">
                    <p className="text-sm text-muted-foreground">{t("reports.ganttHint")}</p>
                    {timelineUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("reports.noTimeline")}</p>
                    ) : (
                      <div ref={timelineScrollRef} className="w-full overflow-auto rounded-2xl border border-border bg-background px-3 py-3 sm:px-4">
                        <div className="grid min-w-[72rem] gap-x-6 gap-y-4" style={{ gridTemplateColumns: "17rem minmax(0, 1fr)" }}>
                          <div className="sticky left-0 z-20 bg-background pl-1" />
                          <div className="relative h-11 overflow-hidden border-b border-border/60 bg-background/95" style={{ width: timelineWidth }}>
                            {timelineMonths.map((segment) => (
                              <div
                                key={segment.key}
                                className="absolute top-0 flex h-11 items-center border-r border-border/60 px-3 text-sm font-medium text-foreground"
                                style={{
                                  left: segment.startIndex * TIMELINE_DAY_WIDTH,
                                  width: segment.dayCount * TIMELINE_DAY_WIDTH,
                                }}
                              >
                                <span className="truncate">{segment.label}</span>
                              </div>
                            ))}
                          </div>

                          {timelineUsers.map((user) => {
                            const lanes = buildTimelineLanes(user.items, report);

                            return (
                              <div key={user.userId} className="contents">
                                <div className="sticky left-0 z-10 flex flex-col justify-center gap-2 border-t border-border bg-background py-3 pl-1 pr-4">
                                  <div className="flex flex-col gap-1">
                                    <p className="truncate text-sm font-medium text-foreground">{user.userName}</p>
                                    <p className="text-xs text-muted-foreground">{user.role}</p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                    {(["work", "vacation", "sick_leave"] as const)
                                      .filter((type) => user.items.some((item) => item.entryType === type))
                                      .map((type) => (
                                        <div key={`${user.userId}-${type}-legend`} className="flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1">
                                          <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi[type].dotClassName}`} />
                                          <span>
                                            {type === "work"
                                              ? t("reports.workRow")
                                              : type === "vacation"
                                                ? t("reports.vacationRow")
                                                : t("reports.sickLeaveRow")}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>

                                <div className="flex flex-col gap-2.5 border-t border-border py-3 pr-1">
                                  {lanes.map((lane, laneIndex) => (
                                    <div
                                      key={`${user.userId}-lane-${laneIndex}`}
                                      className="relative h-10 overflow-hidden rounded-xl"
                                      style={{
                                        width: timelineWidth,
                                        backgroundColor: "hsl(var(--muted) / 0.3)",
                                        backgroundImage: `
                                          linear-gradient(to right, hsl(var(--background) / 0.14) 0, hsl(var(--background) / 0.14) 1px, transparent 1px),
                                          linear-gradient(to bottom, hsl(var(--background) / 0.12), hsl(var(--background) / 0.12))
                                        `,
                                        backgroundSize: `${TIMELINE_DAY_WIDTH}px 100%, 100% 100%`,
                                      }}
                                    >
                                      {lane.map(({ item, leftUnits, widthUnits }) => {
                                        const label = getTimelineItemLabel(item, report);
                                        return (
                                          <div
                                            key={item.entryId}
                                            className={`absolute inset-y-1 flex items-center overflow-hidden rounded-lg px-2.5 text-xs font-medium text-foreground shadow-sm ${entryStateUi[item.entryType].badgeClassName}`}
                                            style={{
                                              left: leftUnits * TIMELINE_DAY_WIDTH,
                                              width: Math.max(widthUnits * TIMELINE_DAY_WIDTH, 48),
                                            }}
                                            title={`${item.userName} / ${label}`}
                                          >
                                            <span className="truncate">{label}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              </>
            ) : null}
          </FormPanel>
        </PageLoadBoundary>
      </div>
    </FormPage>
  );
}
