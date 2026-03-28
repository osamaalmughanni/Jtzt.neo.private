import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
        "flex min-h-10 flex-wrap items-center justify-between gap-2",
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

export function PageActionButton({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-8 rounded-md px-2.5 text-xs", className)}
      {...props}
    />
  );
}
