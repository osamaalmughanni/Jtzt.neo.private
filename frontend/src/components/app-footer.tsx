import { ArrowUpRight, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PublicFooterMode = "auth" | "learn";
type AuthFooterMode = "sign-in" | "register" | "admin";

interface AppFooterProps {
  context: "app" | "public";
  publicMode?: PublicFooterMode;
  authMode?: AuthFooterMode;
}

export function AppFooter({ context, publicMode, authMode }: AppFooterProps) {
  const { t } = useTranslation();

  if (context === "public") {
    const isLearn = publicMode === "learn";
    const actionTo = isLearn ? "/register" : authMode === "admin" ? "/login" : "/admin/login";
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
    <Card className="mt-5 border-border/80 bg-card/95 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 overflow-hidden text-[11px] text-muted-foreground sm:text-xs">
        <p className="truncate whitespace-nowrap">© Jtzt / jtzt.com</p>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher compact />
          <ThemeToggle compact />
        </div>
      </div>
    </Card>
  );
}
