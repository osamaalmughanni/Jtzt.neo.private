import type { Icon } from "phosphor-react";
import { ArrowUpRight, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PublicFooterMode = "auth" | "learn";
type AuthFooterMode = "sign-in" | "register" | "tablet" | "admin";

interface AppFooterProps {
  context: "app" | "public";
  publicMode?: PublicFooterMode;
  authMode?: AuthFooterMode;
  actions?: Array<{
    key: string;
    label: string;
    icon: Icon;
    onClick: () => void;
  }>;
}

export function AppFooter({ context, publicMode, authMode, actions = [] }: AppFooterProps) {
  const { t } = useTranslation();

  if (context === "public") {
    const isLearn = publicMode === "learn";
    const actionTo = isLearn ? "/?mode=register" : authMode === "admin" ? "/" : "/?mode=admin";
    const actionLabel = isLearn ? t("common.register") : authMode === "admin" ? t("common.signIn") : t("common.admin");

    return (
      <div className="w-full overflow-x-auto">
        <div className="flex min-w-max items-center justify-between gap-2 py-1 text-xs text-muted-foreground">
          <Button
            asChild
            variant={isLearn ? "ghost" : "outline"}
            size="sm"
            className="h-8 shrink-0 gap-1 rounded-full px-3 text-xs"
          >
            <Link to={isLearn ? "/login" : "/learn"}>
              {isLearn ? null : <Info className="h-3.5 w-3.5" />}
              {isLearn ? t("common.signIn") : t("common.learnMore")}
            </Link>
          </Button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <LanguageSwitcher compact />
            <ThemeToggle compact />
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground">
              <Link to="/?mode=tablet">
                Tablet
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground">
              <Link to={actionTo}>
                {actionLabel}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="rounded-t-none rounded-b-lg border-border/80 bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground sm:text-xs">
        <p className="min-w-0 truncate whitespace-nowrap">Copyright Jtzt / jtzt.com</p>
        <div className="ml-auto flex items-center gap-2">
          {actions.map((action) => {
            const ActionIcon = action.icon;

            return (
              <Button
                key={action.key}
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 rounded-md p-0"
                aria-label={action.label}
                onClick={action.onClick}
              >
                <ActionIcon size={16} weight="bold" />
              </Button>
            );
          })}
          <LanguageSwitcher compact className="min-w-[3.5rem] justify-center border-0 bg-transparent shadow-none" />
          <ThemeToggle compact className="w-9 border-0 bg-transparent px-0 shadow-none" />
        </div>
      </div>
    </Card>
  );
}
