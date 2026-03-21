import type { ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const APP_CONTENT_LANE_CLASSNAME =
  "mx-auto w-full max-w-full px-4 sm:px-6 lg:px-16 lg:max-w-xl";
export const APP_FULL_BLEED_CLASSNAME = "app-full-bleed max-w-none px-5 sm:px-8 lg:px-10";

export const AppContentLane = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    className?: string;
  }
>(({ children, className }, ref) => {
  return (
    <div ref={ref} className={cn(APP_CONTENT_LANE_CLASSNAME, className)}>
      {children}
    </div>
  );
});
AppContentLane.displayName = "AppContentLane";

export function AppFullBleed({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(APP_FULL_BLEED_CLASSNAME, className)}>{children}</div>;
}
