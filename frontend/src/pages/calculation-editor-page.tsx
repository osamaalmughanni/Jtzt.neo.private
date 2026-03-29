import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CalculationPreviewTable } from "@/components/calculation-preview-table";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { CalculationListResponse, CreateCalculationInput } from "@shared/types/api";
import type { CalculationRecord } from "@shared/types/models";
import { getCalculationPresetDescription, getCalculationPresetLabel } from "@/lib/calculation-presets";

type CalculationFormState = {
  name: string;
  description: string;
  sqlText: string;
  outputMode: CreateCalculationInput["outputMode"];
  chartConfig: CreateCalculationInput["chartConfig"];
};

function createEmptyForm(): CalculationFormState {
  return {
    name: "",
    description: "",
    sqlText: "",
    outputMode: "both",
    chartConfig: {
      type: "bar",
      categoryColumn: "label",
      valueColumn: "value",
      seriesColumn: null,
      stacked: false,
    },
  };
}

function clonePreset(preset: CalculationListResponse["presets"][number], t: ReturnType<typeof useTranslation>["t"]): CalculationFormState {
  return {
    name: getCalculationPresetLabel(preset, t),
    description: getCalculationPresetDescription(preset, t),
    sqlText: preset.sqlText,
    outputMode: preset.outputMode,
    chartConfig: { ...preset.chartConfig },
  };
}

export function CalculationEditorPage({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { calculationId } = useParams();
  const [searchParams] = useSearchParams();
  const presetKey = searchParams.get("preset");
  const { companySession } = useAuth();
  const [form, setForm] = useState<CalculationFormState>(createEmptyForm);
  const [selectedPresetKey, setSelectedPresetKey] = useState(presetKey ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    issues: Array<{ level: "error" | "warning"; message: string }>;
    columns: string[];
    rows: Array<Record<string, string | number | null>>;
  }>({ valid: true, issues: [], columns: [], rows: [] });
  const [validating, setValidating] = useState(false);
  const initializationRef = useRef(false);

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
    if (mode !== "edit" || !calculationId) return null;
    return resource.data?.calculations.find((item) => item.id === Number(calculationId)) ?? null;
  }, [calculationId, mode, resource.data?.calculations]);

  const selectedPreset = useMemo(() => {
    if (!selectedPresetKey) return null;
    return resource.data?.presets.find((preset) => preset.key === selectedPresetKey) ?? null;
  }, [resource.data?.presets, selectedPresetKey]);

  const presetOptions = useMemo(
    () =>
      (resource.data?.presets ?? []).map((preset) => ({
        value: preset.key,
        label: getCalculationPresetLabel(preset, t),
        keywords: [getCalculationPresetDescription(preset, t), preset.key],
      })),
    [resource.data?.presets, t],
  );

  useEffect(() => {
    if (!resource.data) return;

    if (mode === "edit" && currentCalculation) {
      setForm({
        name: currentCalculation.name,
        description: currentCalculation.description ?? "",
        sqlText: currentCalculation.sqlText,
        outputMode: currentCalculation.outputMode,
        chartConfig: { ...currentCalculation.chartConfig },
      });
      initializationRef.current = true;
      return;
    }

    if (mode === "create") {
      if (selectedPreset) {
        setForm(clonePreset(selectedPreset, t));
        initializationRef.current = true;
        return;
      }

      if (!initializationRef.current) {
        setForm(createEmptyForm());
        initializationRef.current = true;
      }
    }
  }, [currentCalculation, mode, resource.data, selectedPreset, t]);

  useEffect(() => {
    if (mode !== "create") return;
    const preset = selectedPresetKey ? resource.data?.presets.find((item) => item.key === selectedPresetKey) ?? null : null;
    if (preset) {
      setForm(clonePreset(preset, t));
    } else if (selectedPresetKey === "") {
      setForm(createEmptyForm());
    }
  }, [mode, resource.data?.presets, selectedPresetKey, t]);

  useEffect(() => {
    if (!companySession || form.sqlText.trim().length < 5) {
      setValidation({ valid: true, issues: [], columns: [], rows: [] });
      return;
    }

    let active = true;
    setValidating(true);
      const timeout = window.setTimeout(() => {
        void api
        .validateCalculation(companySession.token, {
          sqlText: form.sqlText,
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
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [companySession, form.chartConfig, form.sqlText]);

  async function handleSave() {
    if (!companySession) return;

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        sqlText: form.sqlText.trim(),
        outputMode: form.outputMode,
        chartConfig: form.chartConfig,
      };

      if (mode === "create") {
        await api.createCalculation(companySession.token, payload);
        toast({ title: t("calculations.saved") });
        navigate("/calculations");
        return;
      }

      if (!calculationId) return;
      await api.updateCalculation(companySession.token, { ...payload, calculationId: Number(calculationId) });
      toast({ title: t("calculations.saved") });
      navigate("/calculations");
    } catch (error) {
      toast({
        title: t("calculations.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !calculationId) return;

    try {
      setDeleting(true);
      await api.deleteCalculation(companySession.token, Number(calculationId));
      toast({ title: t("calculations.deleted") });
      navigate("/calculations");
    } catch (error) {
      toast({
        title: t("calculations.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  const title = mode === "create" ? t("calculations.addCalculation") : t("calculations.editCalculation");
  const description = t("calculations.editorDescription");

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to="/calculations" label={t("calculations.back")} />
            <PageIntro>
              <PageLabel title={title} description={description} />
            </PageIntro>
          </>
        }
        loading={resource.isLoading}
        refreshing={resource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <FormPanel>
          {mode === "create" ? (
            <FormSection>
              <Field label={t("calculations.presetSelector")}>
                <Combobox
                  value={selectedPresetKey}
                  onValueChange={setSelectedPresetKey}
                  options={presetOptions}
                  placeholder={t("calculations.presetSelectorPlaceholder")}
                  searchPlaceholder={t("calculations.presetSelectorPlaceholder")}
                  emptyText={t("calculations.empty")}
                  searchable
                />
              </Field>
            </FormSection>
          ) : null}

          <FormSection>
            <FormFields>
              <Field label={t("calculations.name")}>
                <Input
                  value={form.name}
                  placeholder={t("calculations.namePlaceholder")}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </Field>
              <Field label={t("calculations.descriptionLabel")}>
                <Textarea
                  value={form.description}
                  placeholder={t("calculations.descriptionPlaceholder")}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>
            </FormFields>
          </FormSection>

          <FormSection>
            <Field label={t("calculations.sql")}>
              <Textarea
                value={form.sqlText}
                placeholder={t("calculations.sqlPlaceholder")}
                className="min-h-[18rem] font-mono text-xs leading-6"
                onChange={(event) => setForm((current) => ({ ...current, sqlText: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("calculations.sqlHint")}</p>
            </Field>
          </FormSection>

          <FormSection className="gap-2">
            {validation.issues.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/20 p-4">
                {validation.issues.map((issue, index) => (
                  <p key={`${issue.level}-${index}`} className={issue.level === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}

            <CalculationPreviewTable
              title={t("calculations.previewTitle")}
              columns={validation.columns}
              rows={validation.rows}
              emptyLabel={t("calculations.noPreviewRows")}
              searchPlaceholder={t("calculations.previewSearchPlaceholder")}
              embedded
              fullHeight
            />
          </FormSection>

          <FormActions>
            {mode === "edit" ? (
              <Button variant="ghost" type="button" onClick={() => setConfirmDeleteOpen(true)}>
                {t("calculations.delete")}
              </Button>
            ) : null}
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? t("calculations.saving") : t("calculations.save")}
            </Button>
          </FormActions>
        </FormPanel>
      </PageLoadBoundary>

      <AppConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t("calculations.deleteConfirmTitle")}
        description={mode === "edit" && calculationId ? t("calculations.deleteConfirmDescription", { name: form.name || calculationId }) : undefined}
        confirmLabel={t("calculations.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => void handleDelete()}
      />
    </FormPage>
  );
}
