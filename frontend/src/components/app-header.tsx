import type { Icon } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, List, LockSimple } from "phosphor-react";
import { formatLocalDay } from "@shared/utils/time";
import { Logo } from "@/components/logo";
import { PageLabel } from "@/components/page-label";
import { useAppHeaderState } from "@/components/app-header-state";
import { getHomePath, type NavigationScope } from "@/lib/navigation";
import { getPageMeta } from "@/lib/page-meta";

export interface HeaderAction {
  to?: string;
  label: string;
  icon: Icon;
  onClick?: () => void;
  key?: string;
}

function getRouteActions(pathname: string, menuTo?: string): HeaderAction[] {
  if (pathname === "/users/create" || /^\/users\/[^/]+\/edit$/.test(pathname)) {
    return [{ to: "/users", label: "Back to users", icon: ArrowLeft }];
  }

  return menuTo ? [{ to: menuTo, label: "Open menu", icon: List }] : [];
}

function mergeHeaderActions(...groups: Array<HeaderAction[] | null | undefined>) {
  const deduped = new Map<string, HeaderAction>();

  for (const group of groups) {
    if (!group) continue;

    for (const action of group) {
      const actionKey = action.key ?? action.to ?? action.label;
      deduped.set(actionKey, action);
    }
  }

  return Array.from(deduped.values());
}

export function AppHeader({
  menuTo,
  lockTo,
  scope,
  title,
  description,
  actions
}: {
  menuTo?: string;
  lockTo?: string;
  scope: NavigationScope;
  title?: string;
  description?: string;
  actions?: HeaderAction[];
}) {
  const location = useLocation();
  const { t } = useTranslation();
  const { actions: pageActions } = useAppHeaderState();
  const meta = scope === "public" ? null : getPageMeta(location.pathname);
  const resolvedTitle = title ?? (meta?.titleKey ? t(meta.titleKey) : undefined);
  const resolvedDescription = description ?? (meta?.descriptionKey ? t(meta.descriptionKey) : undefined);
  const fallbackActions =
    scope === "tablet"
      ? lockTo
        ? [{ to: lockTo, label: "Lock tablet", icon: LockSimple }]
        : []
      : getRouteActions(location.pathname, menuTo);
  const contextualActions = scope === "tablet" ? fallbackActions : pageActions ?? fallbackActions;
  const resolvedActions = mergeHeaderActions(contextualActions, actions);
  const homeTo = (() => {
    const basePath = getHomePath(scope);
    if (scope !== "company" && scope !== "tablet") {
      return basePath;
    }

    const params = new URLSearchParams(location.search);
    const nextParams = new URLSearchParams();
    const user = params.get("user");
    if (user) {
      nextParams.set("user", user);
    }
    nextParams.set("day", formatLocalDay(new Date()));
    const query = nextParams.toString();
    return query ? `${basePath}?${query}` : basePath;
  })();

  return (
    <header className="bg-background">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-0.5">
          <Link to={homeTo} className="inline-flex flex-col items-start">
            <Logo size={88} />
          </Link>
          {resolvedTitle ? (
            <PageLabel title={resolvedTitle} description={resolvedDescription} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {resolvedActions.map((action) => {
            const ActionIcon = action.icon;
            const actionKey = action.key ?? action.to ?? action.label;
            return action.to ? (
              <Link
                key={actionKey}
                to={action.to}
                aria-label={action.label}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border text-foreground transition-opacity hover:opacity-60"
              >
                <ActionIcon size={22} weight="bold" />
              </Link>
            ) : (
              <button
                key={actionKey}
                aria-label={action.label}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border text-foreground transition-opacity hover:opacity-60"
                onClick={action.onClick}
                type="button"
              >
                <ActionIcon size={22} weight="bold" />
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
