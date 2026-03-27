import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DownloadSimple, PencilSimple } from "phosphor-react";
import { AppFullBleed } from "@/components/app-content-lane";
import { FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { Badge } from "@/components/ui/badge";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { exportCalculationExcel } from "@/lib/calculation-export";
import { toast } from "@/lib/toast";
import type { CalculationListResponse, CalculationValidationResponse } from "@shared/types/api";

export function CalculationPreviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { calculationId } = useParams();
  const { companySession } = useAuth();
  const [validation, setValidation] = useState<CalculationValidationResponse>({
    valid: true,
    issues: [],
    columns: [],
    rows: [],
  });
  const [validating, setValidating] = useState(false);

  const resource = usePageResource<CalculationListResponse>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
    load: async () => {
      if (!companySession) {
        return { calculations: [], presets: [] };
      }

      try {
        return await api.listCalculations(companySession.token);
      } catch (error) {
        toast({
          title: t("calculations.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    },
  });

  const currentCalculation = useMemo(() => {
    if (!calculationId) return null;
    return resource.data?.calculations.find((item) => item.id === Number(calculationId)) ?? null;
  }, [calculationId, resource.data?.calculations]);

  useEffect(() => {
    if (!companySession || !currentCalculation) {
      setValidation({ valid: true, issues: [], columns: [], rows: [] });
      return;
    }

    let active = true;
    setValidating(true);
    void api
      .validateCalculation(companySession.token, {
        sqlText: currentCalculation.sqlText,
        chartConfig: currentCalculation.chartConfig,
      })
      .then((response) => {
        if (!active) return;
        setValidation(response);
      })
      .catch((error) => {
        if (!active) return;
        setValidation({
          valid: false,
          issues: [{ level: "error", message: error instanceof Error ? error.message : "Validation failed" }],
          columns: [],
          rows: [],
        });
      })
      .finally(() => {
        if (active) {
          setValidating(false);
        }
      });

    return () => {
      active = false;
    };
  }, [companySession, currentCalculation]);

  if (!calculationId) {
    return (
      <FormPage>
        <PageLoadBoundary
          intro={
            <PageIntro>
              <PageLabel title={t("calculations.previewCalculation")} description={t("calculations.description")} />
            </PageIntro>
          }
          loading={false}
          refreshing={false}
          skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
        >
          <FormPanel>
            <p className="text-sm text-muted-foreground">{t("calculations.empty")}</p>
          </FormPanel>
        </PageLoadBoundary>
      </FormPage>
    );
  }

  if (resource.isLoading || !resource.data) {
    return (
      <FormPage>
        <PageLoadBoundary
          intro={
            <PageIntro>
              <PageLabel title={t("calculations.previewCalculation")} description={t("calculations.description")} />
            </PageIntro>
          }
          loading={resource.isLoading}
          refreshing={resource.isRefreshing}
          skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
        >
          <FormPanel>
            <p className="text-sm text-muted-foreground">{t("calculations.validating")}</p>
          </FormPanel>
        </PageLoadBoundary>
      </FormPage>
    );
  }

  if (!currentCalculation) {
    return (
      <FormPage>
        <PageLoadBoundary
          intro={
            <PageIntro>
              <PageLabel title={t("calculations.previewCalculation")} description={t("calculations.description")} />
            </PageIntro>
          }
          loading={false}
          refreshing={false}
          skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
        >
          <FormPanel>
            <p className="text-sm text-muted-foreground">{t("calculations.empty")}</p>
          </FormPanel>
        </PageLoadBoundary>
      </FormPage>
    );
  }

  return (
    <FormPage className="h-full min-h-0">
      <PageLoadBoundary
        className="min-h-0 flex-1"
        intro={
          <PageIntro>
            <PageBackAction to="/calculations" label={t("calculations.back")} />
            <PageLabel title={currentCalculation.name} description={currentCalculation.description ?? t("calculations.description")} />
            <PageActionBar>
              <PageActionBarActions>
                {!currentCalculation.isBuiltin ? (
                  <PageActionButton asChild>
                    <button type="button" onClick={() => navigate(`/calculations/${currentCalculation.id}/edit`)}>
                      <PencilSimple size={16} weight="bold" />
                      <span className="ml-2">{t("calculations.edit")}</span>
                    </button>
                  </PageActionButton>
                ) : null}
                <PageActionButton asChild>
                  <button type="button" onClick={() => exportCalculationExcel(currentCalculation.name, validation)}>
                    <DownloadSimple size={16} weight="bold" />
                    <span className="ml-2">{t("calculations.exportExcel")}</span>
                  </button>
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={false}
        refreshing={resource.isRefreshing || validating}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <AppFullBleed className="flex min-h-0 flex-1 min-w-0 xl:px-12 2xl:px-16">
          <FormPanel className="flex h-full min-h-0 min-w-0 w-full flex-col gap-5 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2">
              {validating ? (
                <Badge variant="outline" className="rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t("calculations.validating")}
                </Badge>
              ) : null}
            </div>

            {validation.issues.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/20 p-4">
                {validation.issues.map((issue, index) => (
                  <p key={`${issue.level}-${index}`} className={issue.level === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}

            <FormSection className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t("calculations.previewTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("calculations.previewDescription")}</p>
              </div>

              <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-2xl border border-border">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {validation.columns.map((column) => (
                        <th key={column} className="whitespace-nowrap px-4 py-3 text-left font-medium text-foreground">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validation.rows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={Math.max(1, validation.columns.length)}>
                          {t("calculations.noPreviewRows")}
                        </td>
                      </tr>
                    ) : (
                      validation.rows.map((row, index) => (
                        <tr key={index} className="border-b border-border/70 last:border-b-0">
                          {validation.columns.map((column) => (
                            <td key={column} className="px-4 py-3 align-top text-muted-foreground">
                              <span className="whitespace-nowrap">
                                {row[column] === null || row[column] === undefined || row[column] === "" ? "--" : String(row[column])}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </FormSection>
          </FormPanel>
        </AppFullBleed>
      </PageLoadBoundary>
    </FormPage>
  );
}
