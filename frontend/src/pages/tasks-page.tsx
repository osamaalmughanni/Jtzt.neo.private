import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PencilSimple, Trash } from "phosphor-react";
import type { TaskRecord } from "@shared/types/models";
import type { ProjectTaskManagementResponse } from "@shared/types/api";
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
import { useState } from "react";

function countProjectUsage(
  taskId: number,
  projects: ProjectTaskManagementResponse["projects"],
  projectTasks: ProjectTaskManagementResponse["projectTasks"],
) {
  const assignedProjectIds = new Set(projectTasks.filter((assignment) => assignment.taskId === taskId).map((assignment) => assignment.projectId));
  for (const project of projects) {
    if (project.allowAllTasks) {
      assignedProjectIds.add(project.id);
    }
  }
  return assignedProjectIds.size;
}

export function TasksPage() {
  const { t } = useTranslation();
  const { companySession } = useAuth();
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<TaskRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resource = usePageResource<ProjectTaskManagementResponse>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
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

  async function handleDelete(task: TaskRecord) {
    if (!companySession) return;

    try {
      setDeleting(true);
      await api.deleteTask(companySession.token, { taskId: task.id });
      setConfirmDeleteTask(null);
      await resource.reload();
      toast({ title: t("tasks.deleted") });
    } catch (error) {
      toast({
        title: t("tasks.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleting(false);
    }
  }

  const data = resource.data ?? null;

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("tasks.title")} description={t("tasks.description")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton asChild>
                  <Link to="/tasks/create">{t("tasks.addTask")}</Link>
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={resource.isLoading}
        refreshing={resource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {(data?.tasks ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">{t("tasks.empty")}</p>
          ) : (
            <div className="divide-y divide-border">
              {(data?.tasks ?? []).map((task) => {
                const projectUsage = countProjectUsage(task.id, data?.projects ?? [], data?.projectTasks ?? []);

                return (
                  <div key={task.id} className="flex flex-col gap-2 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        type="button"
                        disabled
                        variant="ghost"
                        size="icon"
                        className={`pointer-events-none h-8 w-8 shrink-0 rounded-full border ${task.isActive ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-zinc-400/40 bg-zinc-500/10 text-zinc-600"}`}
                        aria-label={task.isActive ? t("tasks.active") : t("tasks.inactive")}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${task.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                      </Button>
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{task.title}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link to={`/tasks/${task.id}/edit`} aria-label={t("tasks.edit")}>
                            <PencilSimple size={16} weight="bold" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => setConfirmDeleteTask(task)}
                          aria-label={t("tasks.delete")}
                        >
                          <Trash size={16} weight="bold" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1 rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t("tasks.usedInProjects", { value: projectUsage })}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PageLoadBoundary>

      <AppConfirmDialog
        open={confirmDeleteTask !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteTask(null);
        }}
        title={t("tasks.deleteConfirmTitle")}
        description={confirmDeleteTask ? t("tasks.deleteConfirmDescription", { name: confirmDeleteTask.title }) : undefined}
        confirmLabel={t("tasks.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => {
          if (confirmDeleteTask) {
            void handleDelete(confirmDeleteTask);
          }
        }}
      />
    </FormPage>
  );
}
