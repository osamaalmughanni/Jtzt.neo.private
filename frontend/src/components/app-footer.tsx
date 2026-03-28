import type { Icon } from "phosphor-react";
import { motion } from "framer-motion";
import { ArrowUpRight, Dot, Info, LoaderCircleIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAppHeaderState } from "@/components/app-header-state";
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
  const { loadingCount } = useAppHeaderState();
  const isLoading = loadingCount > 0;

  if (context === "public") {
    const isLearn = publicMode === "learn";
    const actionTo = isLearn ? "/?mode=register" : authMode === "admin" ? "/" : "/?mode=admin";
    const actionLabel = isLearn ? t("common.register") : authMode === "admin" ? t("common.signIn") : t("common.admin");

    return (
      <Card className="rounded-none border bg-card px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground sm:text-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            <FooterLoadingIndicator loading={isLoading} />
            <p className="min-w-0 truncate whitespace-nowrap">Jtzt</p>
          </div>
          <div className="ml-auto flex items-center gap-2 overflow-x-auto">
            <ThemeToggle compact className="w-9 border-0 bg-transparent px-0 shadow-none" />
            <Button asChild variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-3 text-xs">
              <Link to="/?mode=tablet">
                Tablet
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-3 text-xs">
              <Link to={actionTo}>
                {actionLabel}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant={isLearn ? "ghost" : "outline"} size="sm" className="h-9 shrink-0 gap-1 px-3 text-xs">
              <Link to={isLearn ? "/login" : "/learn"}>
                {isLearn ? null : <Info className="h-3.5 w-3.5" />}
                {isLearn ? t("common.signIn") : t("common.learnMore")}
              </Link>
            </Button>
            <LanguageSwitcher compact className="min-w-[3.5rem] justify-center border-0 bg-transparent shadow-none" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-none border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground sm:text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <FooterLoadingIndicator loading={isLoading} />
          <p className="min-w-0 truncate whitespace-nowrap">Jtzt</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact className="w-9 border-0 bg-transparent px-0 shadow-none" />
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
        </div>
      </div>
    </Card>
  );
}

function FooterLoadingIndicator({ loading }: { loading: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-transparent"
      aria-label={loading ? "Loading" : "Idle"}
      disabled
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          animate={loading ? { opacity: 0 } : { opacity: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <Dot className="h-4 w-4" strokeWidth={2.5} />
        </motion.span>
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          animate={loading ? { opacity: 1, rotate: 360 } : { opacity: 0, rotate: 0 }}
          transition={
            loading
              ? { opacity: { duration: 0.18 }, rotate: { duration: 0.9, ease: "linear", repeat: Number.POSITIVE_INFINITY } }
              : { duration: 0.18, ease: "easeOut" }
          }
        >
          <LoaderCircleIcon className="h-4 w-4" strokeWidth={1.75} />
        </motion.span>
      </span>
    </Button>
  );
}
