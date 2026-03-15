import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <Card className="mt-5 border-border/80 bg-card/95 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 overflow-hidden text-[11px] text-muted-foreground sm:text-xs">
        <p className="truncate whitespace-nowrap">© {year} jtzt.com</p>
        <span aria-hidden="true" className="shrink-0">
          ·
        </span>
        <p className="truncate whitespace-nowrap">All rights reserved</p>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </Card>
  );
}
