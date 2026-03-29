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
  primary?: ReactNode;
  secondary?: ReactNode;
  message?: ReactNode;
  className?: string;
  secondaryClassName?: string;
  messageClassName?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center gap-3", className)}>
      {primary ? (
        <div className="flex w-full items-center justify-center">
          {primary}
        </div>
      ) : null}
      {secondary ? (
        <div className={cn("flex w-full items-center justify-center", secondaryClassName)}>
          {secondary}
        </div>
      ) : null}
      {message ? (
        <div className={cn("flex w-full items-center justify-center text-center break-words", messageClassName)}>
          {message}
        </div>
      ) : null}
    </div>
  );
}

export function DockActionButton({
  ...props
}: ComponentPropsWithoutRef<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      className={cn("whitespace-nowrap", props.className)}
    />
  );
}
