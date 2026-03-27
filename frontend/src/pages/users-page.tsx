import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CompanyUserListItem } from "@shared/types/models";
import { CrownSimple, Star, User, UserGear } from "phosphor-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { FormPage } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

function getRoleIcon(role: CompanyUserListItem["role"]) {
  if (role === "admin") return CrownSimple;
  if (role === "manager") return UserGear;
  return User;
}

function getRoleLabel(role: CompanyUserListItem["role"], t: (key: string) => string) {
  if (role === "admin") return t("users.adminRole");
  if (role === "manager") return t("users.managerRole");
  return t("users.employeeRole");
}

export function UsersPage() {
  const { t } = useTranslation();
  const { companySession, companyIdentity } = useAuth();
  const usersResource = usePageResource<CompanyUserListItem[]>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
    initialData: null,
    load: async () => {
      if (!companySession) {
        return [];
      }

      try {
        const response = await api.listUsers(companySession.token);
        return response.users;
      } catch (error) {
        toast({
          title: t("users.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed"
        });
        throw error;
      }
    }
  });
  const users = usersResource.data ?? [];

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("users.title")} description={t("users.description")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton asChild>
                  <Link to="/users/create">{t("users.new")}</Link>
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={usersResource.isLoading}
        refreshing={usersResource.isRefreshing}
        skeleton={<PageLoadingState label={t("users.loading")} />}
      >
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {users.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{t("users.empty")}</p> : null}
          {users.length > 0 ? (
            <div className="divide-y divide-border">
              {users.map((user) => {
                const RoleIcon = getRoleIcon(user.role);
                const isCurrentUser = companyIdentity?.user.id === user.id;

                return (
                  <Link
                    key={user.id}
                    to={`/users/${user.id}/edit`}
                    className="group flex items-center gap-3 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Button
                        type="button"
                        disabled
                        variant="ghost"
                        size="icon"
                        className={`pointer-events-none h-8 w-8 shrink-0 rounded-full border ${user.isActive ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-zinc-400/40 bg-zinc-500/10 text-zinc-600"}`}
                        aria-label={user.isActive ? t("users.active") : t("users.inactive")}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                      </Button>
                      <span
                        className="truncate text-sm font-medium text-foreground"
                      >
                        {user.fullName}
                      </span>
                    </div>

                    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                      {isCurrentUser ? (
                        <Badge variant="outline" className="gap-1 rounded-full border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium">
                          <Star size={11} weight="fill" />
                          {t("users.current")}
                        </Badge>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={`gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          user.role === "admin"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                            : user.role === "manager"
                              ? "border-sky-500/40 bg-sky-500/10 text-sky-700"
                              : "border-border bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        <RoleIcon size={12} weight="bold" />
                        {getRoleLabel(user.role, t)}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </PageLoadBoundary>
    </FormPage>
  );
}
