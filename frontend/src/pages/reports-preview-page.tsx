import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ReportRequestInput, ReportResponse } from "@shared/types/api";
import { formatMinutes } from "@shared/utils/time";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCompanyDate, formatCompanyDateTime } from "@/lib/locale-format";
import { exportReportExcel, exportReportPdf } from "@/lib/report-export";
import { loadReportDraft } from "@/lib/report-draft-storage";
import { toast } from "@/lib/toast";

function isLocalDayValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatCellValue(
  value: string | number | null,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
) {
  if (value === null || value === "") return "--";
  if (kind === "duration" && typeof value === "number") return formatMinutes(value);
  if (kind === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
  if (kind === "date" && typeof value === "string") return formatCompanyDate(value, locale);
  if (kind === "datetime" && typeof value === "string" && isLocalDayValue(value)) {
    return formatCompanyDate(value, locale);
  }
  if (kind === "datetime" && typeof value === "string") return formatCompanyDateTime(value, locale, dateTimeFormat);
  if (kind === "number" && typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

export function ReportsPreviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { companySession } = useAuth();
  const draftId = searchParams.get("draft");
  const draft = useMemo(() => loadReportDraft(draftId), [draftId]);
  const [report, setReport] = useState<ReportResponse["report"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companySession || !draft) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void api.previewReport(companySession.token, draft)
      .then((response) => setReport(response.report))
      .catch((error) =>
        toast({
          title: "Could not create report",
          description: error instanceof Error ? error.message : "Request failed",
        }),
      )
      .finally(() => setLoading(false));
  }, [companySession, draft]);

  const backTo = `/reports${draftId ? `?draft=${draftId}` : ""}`;

  useEffect(() => {
    if (!draft && !loading) {
      navigate("/reports", { replace: true });
    }
  }, [draft, loading, navigate]);

  return (
    <FormPage>
      <PageBackAction to={backTo} label="Back to reports" />
      <PageLabel title="Report preview" description="Review the generated overview before you export or refine it." />
      <div className="flex justify-center">
        <div className="w-[calc(100vw-2.5rem)] max-w-[96rem] sm:w-[calc(100vw-4rem)] lg:w-[calc(100vw-8rem)]">
          <FormPanel className="flex flex-col gap-6">
          {loading ? <p className="text-sm text-muted-foreground">Creating report...</p> : null}
          {report ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Period</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatCompanyDate(report.startDate, report.locale)} to {formatCompanyDate(report.endDate, report.locale)}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Entries</p>
                  <p className="text-sm font-medium text-foreground">{report.totals.entryCount}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Hours</p>
                  <p className="text-sm font-medium text-foreground">{formatMinutes(report.totals.durationMinutes)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={() => exportReportExcel(report)} type="button">
                  Export Excel
                </Button>
                <Button variant="outline" onClick={() => exportReportPdf(report)} type="button">
                  Export PDF
                </Button>
              </div>

              <div className="overflow-auto rounded-2xl border border-border">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {report.columns.map((column) => (
                        <th key={column.key} className="whitespace-nowrap px-4 py-3 text-left font-medium text-foreground">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={index} className="border-b border-border/70 last:border-b-0">
                        {report.columns.map((column) => (
                          <td key={column.key} className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {formatCellValue(row[column.key] ?? null, column.kind, report.locale, report.currency, report.dateTimeFormat)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          </FormPanel>
        </div>
      </div>
    </FormPage>
  );
}
