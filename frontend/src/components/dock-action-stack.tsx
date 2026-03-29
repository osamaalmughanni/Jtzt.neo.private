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
    <div className={cn("grid w-full min-h-[8.5rem] grid-rows-[4rem_2rem_2.5rem] justify-items-center gap-2", className)}>
      <div className="flex w-full items-center justify-center">
        {primary}
      </div>
      <div className={cn("flex w-full items-center justify-center", secondaryClassName)}>
        {secondary}
      </div>
      <div className={cn("flex w-full items-center justify-center text-center break-words", messageClassName)}>
        {message}
      </div>
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
