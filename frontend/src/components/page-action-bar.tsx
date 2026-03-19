import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card/95 px-3 py-2 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PageActionBarLead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 flex-1 text-sm text-muted-foreground", className)}>{children}</div>;
}

export function PageActionBarActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("ml-auto flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
