import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DockActionStack({
  primary,
  secondary,
  message,
  className,
  secondaryClassName,
  messageClassName,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  message?: ReactNode;
  className?: string;
  secondaryClassName?: string;
  messageClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="flex items-center justify-center">
        {primary}
      </div>
      {secondary ? (
        <div className={cn("flex items-center justify-center", secondaryClassName)}>
          {secondary}
        </div>
      ) : null}
      {message ? (
        <div className={cn("flex items-center justify-center", messageClassName)}>
          {message}
        </div>
      ) : null}
    </div>
  );
}

export function DockActionButton({
  ...props
}: ComponentPropsWithoutRef<typeof Button>) {
  return <Button variant="ghost" size="default" {...props} />;
}
