import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, PencilSimple, Trash, Wrench } from "phosphor-react";
import type { CalculationRecord, CalculationPresetRecord } from "@shared/types/models";
import type { CalculationListResponse } from "@shared/types/api";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { FormPage } from "@/components/form-layout";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { getCalculationPresetDescription, getCalculationPresetLabel } from "@/lib/calculation-presets";

export function CalculationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { companySession } = useAuth();
  const [confirmDeleteCalculation, setConfirmDeleteCalculation] = useState<CalculationRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState("");
  const [creatingPreset, setCreatingPreset] = useState(false);

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

  async function handleDelete(calculation: CalculationRecord) {
    if (!companySession) return;

    try {
      setDeleting(true);
      await api.deleteCalculation(companySession.token, calculation.id);
      setConfirmDeleteCalculation(null);
      await resource.reload();
      toast({ title: t("calculations.deleted") });
    } catch (error) {
      toast({
        title: t("calculations.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  const data = resource.data ?? null;
  const presetOptions = useMemo(
    () =>
      (data?.presets ?? []).map((preset) => ({
        value: preset.key,
        label: getCalculationPresetLabel(preset, t),
        keywords: [getCalculationPresetDescription(preset, t), preset.key],
      })),
    [data?.presets, t],
  );
  const selectedPreset = useMemo(
    () => data?.presets.find((preset) => preset.key === selectedPresetKey) ?? null,
    [data?.presets, selectedPresetKey],
  );

  useEffect(() => {
    if (!selectedPresetKey && presetOptions.length > 0) {
      setSelectedPresetKey(presetOptions[0].value);
    }
  }, [presetOptions, selectedPresetKey]);

  async function handleCreateFromPreset() {
    if (!companySession || !selectedPresetKey) return;

    try {
      setCreatingPreset(true);
      const response = await api.createCalculationFromPreset(companySession.token, { presetKey: selectedPresetKey });
      toast({ title: t("calculations.saved") });
      navigate(`/calculations/${response.calculationId}/edit`);
    } catch (error) {
      toast({
        title: t("calculations.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setCreatingPreset(false);
    }
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("calculations.title")} description={t("calculations.description")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton asChild>
                  <Link to="/calculations/create">{t("calculations.addCalculation")}</Link>
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={resource.isLoading}
        refreshing={resource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Wrench size={16} weight="bold" className="text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">{t("calculations.presetsTitle")}</h2>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {t("calculations.usePreset")}
              </p>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Combobox
                  value={selectedPresetKey}
                  onValueChange={setSelectedPresetKey}
                  options={presetOptions}
                  placeholder={t("calculations.presetSelectorPlaceholder")}
                  searchPlaceholder={t("calculations.presetSelectorPlaceholder")}
                  emptyText={t("calculations.empty")}
                  searchable
                  className="md:flex-1"
                />
                <Button type="button" onClick={() => void handleCreateFromPreset()} disabled={!selectedPresetKey || creatingPreset}>
                  {creatingPreset ? t("calculations.saving") : t("calculations.createFromPreset")}
                </Button>
              </div>
              {selectedPresetKey ? (
                <p className="text-xs text-muted-foreground">
                  {t("calculations.presetSelected", { preset: selectedPreset ? getCalculationPresetLabel(selectedPreset, t) : selectedPresetKey })}
                </p>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Wrench size={16} weight="bold" className="text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">{t("calculations.savedTitle")}</h2>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {(data?.calculations ?? []).length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">{t("calculations.empty")}</p>
              ) : (
                <div className="divide-y divide-border">
                  {(data?.calculations ?? []).map((calculation) => (
                    <div key={calculation.id} className="flex flex-col gap-2 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{calculation.name}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button asChild variant="ghost" size="icon">
                            <Link to={`/calculations/${calculation.id}/preview`} aria-label={t("calculations.previewCalculation")}>
                              <Eye size={16} weight="bold" />
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="icon">
                            <Link to={`/calculations/${calculation.id}/edit`} aria-label={t("calculations.edit")}>
                              <PencilSimple size={16} weight="bold" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={() => setConfirmDeleteCalculation(calculation)}
                            aria-label={t("calculations.delete")}
                          >
                            <Trash size={16} weight="bold" />
                          </Button>
                        </div>
                      </div>
                      {calculation.isBuiltin ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant="outline" className="rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {t("calculations.builtin")}
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </PageLoadBoundary>

      <AppConfirmDialog
        open={confirmDeleteCalculation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteCalculation(null);
        }}
        title={t("calculations.deleteConfirmTitle")}
        description={confirmDeleteCalculation ? t("calculations.deleteConfirmDescription", { name: confirmDeleteCalculation.name }) : undefined}
        confirmLabel={t("calculations.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => {
          if (confirmDeleteCalculation) {
            void handleDelete(confirmDeleteCalculation);
          }
        }}
      />
    </FormPage>
  );
}
