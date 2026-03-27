import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ListChecks, PencilSimple, Trash, UsersThree } from "phosphor-react";
import type { ProjectRecord } from "@shared/types/models";
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

function countAssignments(projectId: number, rows: Array<{ projectId: number }>) {
  return rows.filter((row) => row.projectId === projectId).length;
}

export function ProjectsPage() {
  const { t } = useTranslation();
  const { companySession } = useAuth();
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<ProjectRecord | null>(null);
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
          title: t("projects.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    },
  });

  async function handleDelete(project: ProjectRecord) {
    if (!companySession) return;

    try {
      setDeleting(true);
      await api.deleteProject(companySession.token, { projectId: project.id });
      setConfirmDeleteProject(null);
      await resource.reload();
      toast({ title: t("projects.deleted") });
    } catch (error) {
      toast({
        title: t("projects.deleteFailed"),
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
            <PageLabel title={t("projects.title")} description={t("projects.description")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton asChild>
                  <Link to="/projects/create">{t("projects.addProject")}</Link>
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
          {(data?.projects ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">{t("projects.empty")}</p>
          ) : (
            <div className="divide-y divide-border">
              {(data?.projects ?? []).map((project) => {
                const assignedUsers = countAssignments(project.id, data?.projectUsers ?? []);
                const assignedTasks = countAssignments(project.id, data?.projectTasks ?? []);
                const usersLabel = project.allowAllUsers ? t("projects.usersAll") : t("projects.usersSelectedHint", { value: assignedUsers });
                const tasksLabel = project.allowAllTasks ? t("projects.tasksAll") : t("projects.tasksSelectedHint", { value: assignedTasks });
                const budgetLabel = t("projects.budgetValue", {
                  value: new Intl.NumberFormat().format(project.budget),
                });

                return (
                  <div key={project.id} className="flex flex-col gap-2 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        type="button"
                        disabled
                        variant="ghost"
                        size="icon"
                        className={`pointer-events-none h-8 w-8 shrink-0 rounded-full border ${project.isActive ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-zinc-400/40 bg-zinc-500/10 text-zinc-600"}`}
                        aria-label={project.isActive ? t("projects.active") : t("projects.inactive")}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${project.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                      </Button>
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{project.name}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link to={`/projects/${project.id}/edit`} aria-label={t("projects.edit")}>
                            <PencilSimple size={16} weight="bold" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => setConfirmDeleteProject(project)}
                          aria-label={t("projects.delete")}
                        >
                          <Trash size={16} weight="bold" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1 rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <UsersThree size={11} weight="bold" />
                          {usersLabel}
                        </Badge>
                        <Badge variant="outline" className="gap-1 rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <ListChecks size={11} weight="bold" />
                          {tasksLabel}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {budgetLabel}
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
        open={confirmDeleteProject !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteProject(null);
        }}
        title={t("projects.deleteConfirmTitle")}
        description={confirmDeleteProject ? t("projects.deleteConfirmDescription", { name: confirmDeleteProject.name }) : undefined}
        confirmLabel={t("projects.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => {
          if (confirmDeleteProject) {
            void handleDelete(confirmDeleteProject);
          }
        }}
      />
    </FormPage>
  );
}
