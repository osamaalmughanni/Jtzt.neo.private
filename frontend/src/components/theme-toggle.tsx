import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-2 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
      onClick={toggleTheme}
    >
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {!compact ? <span>{theme === "dark" ? t("theme.light") : t("theme.dark")}</span> : null}
    </Button>
  );
}
