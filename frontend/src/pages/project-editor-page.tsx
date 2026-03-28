import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageBackAction } from "@/components/page-back-action";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CustomFieldField } from "@/components/custom-field-field";
import { Field, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createDefaultCompanySettings, useCompanySettings } from "@/lib/company-settings";
import { toast } from "@/lib/toast";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import type { CompanyCustomField, CompanySettings } from "@shared/types/models";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
import { getCustomFieldsForTarget } from "@shared/utils/custom-fields";

type ProjectFormState = {
  name: string;
  description: string;
  budget: string;
  isActive: boolean;
  allowAllUsers: boolean;
  allowAllTasks: boolean;
  userIds: number[];
  taskIds: number[];
  customFieldValues: Record<string, string | number | boolean>;
};

function createEmptyForm(): ProjectFormState {
  return {
    name: "",
    description: "",
    budget: "",
    isActive: true,
    allowAllUsers: true,
    allowAllTasks: true,
    userIds: [],
    taskIds: [],
    customFieldValues: {},
  };
}

export function ProjectEditorPage({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { companySession } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [settingsCustomFields, setSettingsCustomFields] = useState<CompanyCustomField[]>([]);
  const [form, setForm] = useState<ProjectFormState>(createEmptyForm);

  const resource = usePageResource<ProjectTaskManagementResponse & { settings: CompanySettings }>({
    enabled: Boolean(companySession) && (mode === "create" || Boolean(projectId)),
    deps: [companySession?.token, mode, projectId, t],
    load: async () => {
      if (!companySession) {
        return { users: [], projects: [], tasks: [], projectUsers: [], projectTasks: [], settings: companySettings ?? createDefaultCompanySettings() };
      }

      try {
        const projectData = await api.listProjectData(companySession.token);
        return { ...projectData, settings: companySettings ?? createDefaultCompanySettings() };
      } catch (error) {
        toast({
          title: t("projects.loadFailed"),
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
    if (mode === "edit" && projectId) {
      const project = data.projects.find((item) => item.id === Number(projectId));
      if (project) {
        const assignedUserIds = data.projectUsers.filter((row) => row.projectId === project.id).map((row) => row.userId);
        const assignedTaskIds = data.projectTasks.filter((row) => row.projectId === project.id).map((row) => row.taskId);
        setForm({
          name: project.name,
          description: project.description ?? "",
          budget: String(project.budget ?? 0),
          isActive: project.isActive,
          allowAllUsers: project.allowAllUsers,
          allowAllTasks: project.allowAllTasks,
          userIds: assignedUserIds,
          taskIds: assignedTaskIds,
          customFieldValues: project.customFieldValues ?? {},
        });
      }
    }
  }, [mode, projectId, resource.data]);

  const projectCustomFields = useMemo(
    () => getCustomFieldsForTarget(settingsCustomFields, { scope: "project" }),
    [settingsCustomFields],
  );

  const userOptions = useMemo(
    () =>
      (resource.data?.users ?? []).map((user) => ({
        value: String(user.id),
        label: `${user.fullName}${user.role === "admin" ? " · Admin" : user.role === "manager" ? " · Manager" : " · Employee"}`,
      })),
    [resource.data?.users],
  );
  const taskOptions = useMemo(
    () => (resource.data?.tasks ?? []).map((task) => ({ value: String(task.id), label: task.title })),
    [resource.data?.tasks],
  );

  async function handleSave() {
    if (!companySession) return;
    if (form.name.trim().length < 2) {
      toast({ title: t("projects.nameRequired") });
      return;
    }
    const budget = Number(form.budget);
    if (Number.isNaN(budget) || budget < 0) {
      toast({ title: t("projects.budgetInvalid") });
      return;
    }

    try {
      setSaving(true);
      if (!form.allowAllUsers && form.userIds.length === 0) {
        throw new Error(t("projects.usersRequired", { defaultValue: "Select at least one user or enable all users." }));
      }
      if (!form.allowAllTasks && form.taskIds.length === 0) {
        throw new Error(t("projects.tasksRequired", { defaultValue: "Select at least one task or enable all tasks." }));
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        budget,
        isActive: form.isActive,
        allowAllUsers: form.allowAllUsers,
        allowAllTasks: form.allowAllTasks,
        userIds: form.allowAllUsers ? [] : Array.from(new Set(form.userIds)),
        taskIds: form.allowAllTasks ? [] : Array.from(new Set(form.taskIds)),
        customFieldValues: form.customFieldValues,
      };

      if (mode === "create") {
        await api.createProject(companySession.token, payload);
        toast({ title: t("projects.saved") });
        navigate("/projects");
        return;
      }

      if (!projectId) return;
      await api.updateProject(companySession.token, { ...payload, projectId: Number(projectId) });
      toast({ title: t("projects.saved") });
      navigate("/projects");
    } catch (error) {
      toast({
        title: t("projects.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !projectId) return;

    try {
      setDeleting(true);
      await api.deleteProject(companySession.token, { projectId: Number(projectId) });
      toast({ title: t("projects.deleted") });
      navigate("/projects");
    } catch (error) {
      toast({
        title: t("projects.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  const title = mode === "create" ? t("projects.addProject") : t("projects.editProject");
  const description = t("projects.sheetDescription");

  function setCustomFieldValue(fieldId: string, nextValue: string | number | boolean | undefined) {
    setForm((current) => ({
      ...current,
      customFieldValues: {
        ...current.customFieldValues,
        [fieldId]: nextValue ?? "",
      },
    }));
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to="/projects" label={t("projects.back")} />
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
          <FormSection>
            <FormFields>
              <Field label={t("projects.name")}>
                <Input
                  value={form.name}
                  placeholder={t("projects.namePlaceholder", { defaultValue: "Project name" })}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </Field>
              <Field label={t("projects.projectDescription")}>
                <Textarea
                  value={form.description}
                  placeholder={t("projects.projectDescriptionPlaceholder", { defaultValue: "Short project description" })}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>
              <Field label={t("projects.budget")}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.budget}
                  placeholder={t("projects.budgetPlaceholder", { defaultValue: "0.00" })}
                  onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))}
                />
              </Field>
              <Field label={t("projects.active")}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                  <span className="text-sm text-foreground">{form.isActive ? t("settings.enabled") : t("settings.disabled")}</span>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </Field>
              <Field label={t("projects.assignUsers")}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                  <span className="text-sm text-foreground">{form.allowAllUsers ? t("projects.usersAll") : t("projects.usersSelectedHint", { value: form.userIds.length })}</span>
                  <Switch
                    checked={form.allowAllUsers}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        allowAllUsers: checked,
                        userIds: checked ? [] : current.userIds,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label={t("projects.assignTasks")}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                  <span className="text-sm text-foreground">{form.allowAllTasks ? t("projects.tasksAll") : t("projects.tasksSelectedHint", { value: form.taskIds.length })}</span>
                  <Switch
                    checked={form.allowAllTasks}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        allowAllTasks: checked,
                        taskIds: checked ? [] : current.taskIds,
                      }))
                    }
                  />
                </div>
              </Field>
            </FormFields>
          </FormSection>

          {projectCustomFields.length > 0 ? (
            <FormSection>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t("projects.customFields")}</p>
                <p className="text-xs text-muted-foreground">{t("projects.customFieldsDescription")}</p>
              </div>
              <FormFields>
                {projectCustomFields.map((field) => (
                  <CustomFieldField
                    key={field.id}
                    field={field}
                    value={form.customFieldValues[field.id]}
                    locale={resource.data?.settings.locale ?? "en-GB"}
                    onValueChange={(value) => setCustomFieldValue(field.id, value)}
                    booleanLabels={{ yes: t("settings.enabled"), no: t("settings.disabled") }}
                  />
                ))}
              </FormFields>
            </FormSection>
          ) : null}

          {!form.allowAllUsers ? (
            <FormSection>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t("projects.assignUsers")}</p>
                <p className="text-sm text-muted-foreground">{t("projects.assignUsersDescription")}</p>
              </div>
              <MultiSelectFilter
                value={form.userIds.map(String)}
                onChange={(values) =>
                  setForm((current) => ({
                    ...current,
                    allowAllUsers: false,
                    userIds: values.map(Number),
                  }))
                }
                options={userOptions}
                searchPlaceholder={t("reports.search")}
                emptyText={t("reports.noResults")}
                selectAllLabel={t("reports.selectAll", { defaultValue: "Select all" })}
                clearLabel={t("reports.clearSelection", { defaultValue: "Clear selection" })}
              />
            </FormSection>
          ) : null}

          {!form.allowAllTasks ? (
            <FormSection>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t("projects.assignTasks")}</p>
                <p className="text-sm text-muted-foreground">{t("projects.assignTasksDescription")}</p>
              </div>
              <MultiSelectFilter
                value={form.taskIds.map(String)}
                onChange={(values) =>
                  setForm((current) => ({
                    ...current,
                    allowAllTasks: false,
                    taskIds: values.map(Number),
                  }))
                }
                options={taskOptions}
                searchPlaceholder={t("reports.search")}
                emptyText={t("reports.noResults")}
                selectAllLabel={t("reports.selectAll", { defaultValue: "Select all" })}
                clearLabel={t("reports.clearSelection", { defaultValue: "Clear selection" })}
              />
            </FormSection>
          ) : null}

          <FormActions>
            {mode === "edit" ? (
              <Button variant="ghost" type="button" onClick={() => setConfirmDeleteOpen(true)}>
                {t("projects.delete")}
              </Button>
            ) : null}
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? t("projects.saving") : t("projects.save")}
            </Button>
          </FormActions>
        </FormPanel>
      </PageLoadBoundary>

      <AppConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t("projects.deleteConfirmTitle")}
        description={mode === "edit" && projectId ? t("projects.deleteConfirmDescription", { name: form.name || projectId }) : undefined}
        confirmLabel={t("projects.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => void handleDelete()}
      />
    </FormPage>
  );
}
