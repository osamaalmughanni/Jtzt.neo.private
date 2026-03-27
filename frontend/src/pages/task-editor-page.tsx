import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
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
import { toast } from "@/lib/toast";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
import type { TaskRecord } from "@shared/types/models";

type TaskFormState = {
  title: string;
  isActive: boolean;
};

function createEmptyForm(): TaskFormState {
  return {
    title: "",
    isActive: true,
  };
}

export function TaskEditorPage({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { taskId } = useParams();
  const { companySession } = useAuth();
  const [form, setForm] = useState<TaskFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const resource = usePageResource<ProjectTaskManagementResponse>({
    enabled: Boolean(companySession) && (mode === "create" || Boolean(taskId)),
    deps: [companySession?.token, mode, taskId, t],
    load: async () => {
      if (!companySession) {
        return { users: [], projects: [], tasks: [], projectUsers: [], projectTasks: [] };
      }

      try {
        return await api.listProjectData(companySession.token);
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
    if (!data || mode !== "edit" || !taskId) return;
    const task = data.tasks.find((item) => item.id === Number(taskId));
    if (task) {
      setForm({ title: task.title, isActive: task.isActive });
    }
  }, [mode, resource.data, taskId]);

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
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </Field>
              <Field label={t("tasks.active")}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                  <span className="text-sm text-foreground">{form.isActive ? t("settings.enabled") : t("settings.disabled")}</span>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </Field>
            </FormFields>
          </FormSection>

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
