import type { Icon } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { List } from "phosphor-react";
import { Logo } from "@/components/logo";
import { PageLabel } from "@/components/page-label";
import { getHomePath, type NavigationScope } from "@/lib/navigation";
import { getPageMeta } from "@/lib/page-meta";

export interface HeaderAction {
  to: string;
  label: string;
  icon: Icon;
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
  const meta = getPageMeta(location.pathname);
  const resolvedTitle = title ?? (meta?.titleKey ? t(meta.titleKey) : undefined);
  const resolvedDescription = description ?? (meta?.descriptionKey ? t(meta.descriptionKey) : undefined);
  const resolvedActions = actions ?? (menuTo ? [{ to: menuTo, label: "Open menu", icon: List }] : []);

  return (
    <header className="mb-5 bg-background py-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={getHomePath(scope)} className="inline-flex flex-col items-start">
            <Logo size={88} />
          </Link>
          {resolvedTitle ? (
            <PageLabel className="mt-0.5" title={resolvedTitle} description={resolvedDescription} />
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
