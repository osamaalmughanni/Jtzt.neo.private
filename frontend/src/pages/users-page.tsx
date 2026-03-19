import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CompanyUserListItem } from "@shared/types/models";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { FormPage } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

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
              {users.map((user) => (
                <Link
                  key={user.id}
                  to={`/users/${user.id}/edit`}
                  className="flex items-center gap-3 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30"
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      user.isActive ? "bg-emerald-500" : "bg-zinc-300"
                    }`}
                  />
                  <span>{user.fullName}</span>
                  {companyIdentity?.user.id === user.id ? <span className="text-xs text-muted-foreground">{t("users.you")}</span> : null}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </PageLoadBoundary>
    </FormPage>
  );
}
