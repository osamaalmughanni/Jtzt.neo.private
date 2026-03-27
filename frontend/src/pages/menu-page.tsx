import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CompanySettings } from "@shared/types/models";
import { FormPage } from "@/components/form-layout";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { Stack } from "@/components/stack";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

export function MenuPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companyIdentity, companySession, logoutCompany } = useAuth();
  const settingsResource = usePageResource<CompanySettings>({
    enabled: Boolean(companySession),
    deps: [companySession?.token],
    load: async () => {
      if (!companySession) {
        throw new Error("Company session missing");
      }

      try {
        const response = await api.getSettings(companySession.token);
        return response.settings;
      } catch (error) {
        toast({
          title: t("settings.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    },
  });

  const settings = settingsResource.data ?? null;
  const projectsEnabled = settings?.projectsEnabled ?? false;
  const tasksEnabled = settings?.tasksEnabled ?? false;

  const items = [
    { to: "/dashboard", title: t("menu.dashboard") },
    ...((companyIdentity?.user.role === "admin" || companyIdentity?.user.role === "manager")
      ? [{ to: "/reports", title: t("menu.reports") }]
    : []),
    ...(companyIdentity?.user.role === "admin"
          ? [
              { to: "/users", title: t("menu.users") },
              ...(projectsEnabled ? [{ to: "/projects", title: t("menu.projects") }] : []),
              { to: "/calculations", title: t("menu.calculations") },
              ...(tasksEnabled ? [{ to: "/tasks", title: t("menu.tasks") }] : []),
              { to: "/fields", title: t("menu.fields") },
          { to: "/settings", title: t("menu.settings") },
          { to: "/api-access", title: "API" }
        ]
      : [])
  ];

  return (
    <FormPage>
      <PageLoadBoundary
        loading={settingsResource.isLoading}
        refreshing={settingsResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} minHeightClassName="min-h-[20rem]" />}
      >
        <Stack gap="lg">
          <nav className="flex flex-col">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="py-1.5 text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground transition-opacity hover:opacity-60"
              >
                {item.title}
              </Link>
            ))}
          </nav>
          <div className="py-5">
            <div className="h-px w-8 bg-foreground/20" />
          </div>
          <button
            className="appearance-none border-0 bg-transparent p-0 py-1.5 text-left text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground transition-opacity hover:opacity-60 focus:outline-none"
            onClick={() => {
              logoutCompany();
              navigate("/login");
            }}
            type="button"
          >
            {t("menu.logout")}
          </button>
        </Stack>
      </PageLoadBoundary>
    </FormPage>
  );
}
