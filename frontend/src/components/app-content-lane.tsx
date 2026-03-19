import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const APP_CONTENT_LANE_CLASSNAME = "mx-auto w-full max-w-xl px-5 sm:px-8 lg:px-16";

export function AppContentLane({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(APP_CONTENT_LANE_CLASSNAME, className)}>{children}</div>;
}
