import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages, type AppLanguage } from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { i18n, t } = useTranslation();
  const currentLanguage = supportedLanguages.find((language) => language.code === i18n.language) ?? supportedLanguages[0];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-9 gap-1.5 rounded-md px-3 text-xs", className)}
        >
          <Languages className="h-3.5 w-3.5" />
          <span>{currentLanguage.code.toUpperCase()}</span>
          {!compact ? <span className="sr-only">{t("common.language")}</span> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("common.language")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {supportedLanguages.map((language) => {
            const active = i18n.language === language.code;

            return (
              <Button
                key={language.code}
                type="button"
                variant={active ? "secondary" : "ghost"}
                className="h-auto w-full justify-between rounded-xl px-3 py-3 text-left"
                onClick={() => void i18n.changeLanguage(language.code as AppLanguage)}
              >
                <span className="flex flex-col items-start">
                  <span className="text-sm font-medium">{language.nativeLabel}</span>
                  <span className="text-xs text-muted-foreground">{language.label}</span>
                </span>
                {active ? <Check className="h-4 w-4" /> : null}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
