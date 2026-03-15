import type { Icon } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, List } from "phosphor-react";
import { Logo } from "@/components/logo";
import { PageLabel } from "@/components/page-label";
import { useAppHeaderState } from "@/components/app-header-state";
import { getHomePath, type NavigationScope } from "@/lib/navigation";
import { getPageMeta } from "@/lib/page-meta";

export interface HeaderAction {
  to: string;
  label: string;
  icon: Icon;
}

function getRouteActions(pathname: string, menuTo?: string): HeaderAction[] {
  if (pathname === "/users/create" || /^\/users\/[^/]+\/edit$/.test(pathname)) {
    return [{ to: "/users", label: "Back to users", icon: ArrowLeft }];
  }

  return menuTo ? [{ to: menuTo, label: "Open menu", icon: List }] : [];
}

export function AppHeader({
  menuTo,
  scope,
  title,
  description,
  actions
}: {
  menuTo?: string;
  scope: NavigationScope;
  title?: string;
  description?: string;
  actions?: HeaderAction[];
}) {
  const location = useLocation();
  const { t } = useTranslation();
  const { actions: pageActions } = useAppHeaderState();
  const meta = getPageMeta(location.pathname);
  const resolvedTitle = title ?? (meta?.titleKey ? t(meta.titleKey) : undefined);
  const resolvedDescription = description ?? (meta?.descriptionKey ? t(meta.descriptionKey) : undefined);
  const resolvedActions = pageActions ?? actions ?? getRouteActions(location.pathname, menuTo);

  return (
    <header className="bg-background">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-0.5">
          <Link to={getHomePath(scope)} className="inline-flex flex-col items-start">
            <Logo size={88} />
          </Link>
          {resolvedTitle ? (
            <PageLabel title={resolvedTitle} description={resolvedDescription} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {resolvedActions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Link
                key={action.to}
                to={action.to}
                aria-label={action.label}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border text-foreground transition-opacity hover:opacity-60"
              >
                <ActionIcon size={22} weight="bold" />
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
