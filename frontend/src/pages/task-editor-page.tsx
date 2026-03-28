import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { CustomFieldInput } from "@/components/custom-field-input";
import { PageBackAction } from "@/components/page-back-action";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createDefaultCompanySettings, useCompanySettings } from "@/lib/company-settings";
import { toast } from "@/lib/toast";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
import type { CompanyCustomField, CompanySettings } from "@shared/types/models";
import { getCustomFieldsForTarget } from "@shared/utils/custom-fields";

type TaskFormState = {
  title: string;
  isActive: boolean;
  customFieldValues: Record<string, string | number | boolean>;
};

function createEmptyForm(): TaskFormState {
  return {
    title: "",
    isActive: true,
    customFieldValues: {},
  };
}

export function TaskEditorPage({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { taskId } = useParams();
  const { companySession } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const [settingsCustomFields, setSettingsCustomFields] = useState<CompanyCustomField[]>([]);
  const [form, setForm] = useState<TaskFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const resource = usePageResource<ProjectTaskManagementResponse & { settings: CompanySettings }>({
    enabled: Boolean(companySession) && (mode === "create" || Boolean(taskId)),
    deps: [companySession?.token, mode, taskId, t],
    load: async () => {
      if (!companySession) {
        return { users: [], projects: [], tasks: [], projectUsers: [], projectTasks: [], settings: companySettings ?? createDefaultCompanySettings() };
      }

      try {
        const projectData = await api.listProjectData(companySession.token);
        return { ...projectData, settings: companySettings ?? createDefaultCompanySettings() };
      } catch (error) {
        toast({
          title: t("tasks.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    },
  });

  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    setSettingsCustomFields(data.settings.customFields);
    if (mode !== "edit" || !taskId) return;
    const task = data.tasks.find((item) => item.id === Number(taskId));
    if (task) {
      setForm({ title: task.title, isActive: task.isActive, customFieldValues: task.customFieldValues ?? {} });
    }
  }, [mode, resource.data, taskId]);

  const taskCustomFields = useMemo(
    () => getCustomFieldsForTarget(settingsCustomFields, { scope: "task" }),
    [settingsCustomFields],
  );

  function setCustomFieldValue(fieldId: string, nextValue: string | number | boolean | undefined) {
    setForm((current) => ({
      ...current,
      customFieldValues: {
        ...current.customFieldValues,
        [fieldId]: nextValue ?? "",
      },
    }));
  }

  async function handleSave() {
    if (!companySession) return;
    if (form.title.trim().length < 2) {
      toast({ title: t("tasks.titleRequired") });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        title: form.title.trim(),
        isActive: form.isActive,
        customFieldValues: form.customFieldValues,
      };

      if (mode === "create") {
        await api.createTask(companySession.token, payload);
        toast({ title: t("tasks.saved") });
        navigate("/tasks");
        return;
      }

      if (!taskId) return;
      await api.updateTask(companySession.token, { ...payload, taskId: Number(taskId) });
      toast({ title: t("tasks.saved") });
      navigate("/tasks");
    } catch (error) {
      toast({
        title: t("tasks.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !taskId) return;

    try {
      setDeleting(true);
      await api.deleteTask(companySession.token, { taskId: Number(taskId) });
      toast({ title: t("tasks.deleted") });
      navigate("/tasks");
    } catch (error) {
      toast({
        title: t("tasks.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  const title = mode === "create" ? t("tasks.addTask") : t("tasks.editTask");

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to="/tasks" label={t("tasks.back")} />
            <PageIntro>
              <PageLabel title={title} description={t("tasks.sheetDescription")} />
            </PageIntro>
          </>
        }
        loading={resource.isLoading}
        refreshing={resource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <FormPanel>
          <FormSection>
            <FormFields>
              <Field label={t("tasks.title")}>
                <Input
                  value={form.title}
                  placeholder={t("tasks.titlePlaceholder", { defaultValue: "Task title" })}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                />
              </Field>
              <Field label={t("tasks.active")}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                  <span className="text-sm text-foreground">{form.isActive ? t("settings.enabled") : t("settings.disabled")}</span>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </Field>
            </FormFields>
          </FormSection>

          {taskCustomFields.length > 0 ? (
            <FormSection>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t("tasks.customFields")}</p>
                <p className="text-xs text-muted-foreground">{t("tasks.customFieldsDescription")}</p>
              </div>
              <FormFields>
                {taskCustomFields.map((field) => (
                  <Field key={field.id} label={field.label}>
                    <CustomFieldInput
                      field={field}
                      value={form.customFieldValues[field.id]}
                      locale={resource.data?.settings.locale ?? "en-GB"}
                      onValueChange={(value) => setCustomFieldValue(field.id, value)}
                      booleanLabels={{ yes: t("settings.enabled"), no: t("settings.disabled") }}
                    />
                  </Field>
                ))}
              </FormFields>
            </FormSection>
          ) : null}

          <FormActions>
            {mode === "edit" ? (
              <Button variant="ghost" type="button" onClick={() => setConfirmDeleteOpen(true)}>
                {t("tasks.delete")}
              </Button>
            ) : null}
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? t("tasks.saving") : t("tasks.save")}
            </Button>
          </FormActions>
        </FormPanel>
      </PageLoadBoundary>

      <AppConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t("tasks.deleteConfirmTitle")}
        description={mode === "edit" && taskId ? t("tasks.deleteConfirmDescription", { name: form.title || taskId }) : undefined}
        confirmLabel={t("tasks.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => void handleDelete()}
      />
    </FormPage>
  );
}
