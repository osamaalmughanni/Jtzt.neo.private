import { Check, ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages, type AppLanguage } from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { i18n, t } = useTranslation();
  const currentLanguage = supportedLanguages.find((language) => language.code === i18n.language) ?? supportedLanguages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("h-9 gap-1.5 rounded-md px-3 text-xs", className)}>
          <Languages className="h-3.5 w-3.5" />
          <span>{currentLanguage.code.toUpperCase()}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
          {!compact ? <span className="sr-only">{t("common.language")}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {supportedLanguages.map((language) => {
          const active = i18n.language === language.code;

          return (
            <DropdownMenuItem
              key={language.code}
              onSelect={() => void i18n.changeLanguage(language.code as AppLanguage)}
              className="justify-between gap-3"
            >
              <span className="min-w-0 text-sm font-medium">{language.nativeLabel}</span>
              {active ? <Check className="h-4 w-4 shrink-0" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
