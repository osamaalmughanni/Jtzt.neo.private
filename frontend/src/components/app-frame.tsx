import type { ReactNode } from "react";
import { APP_CONTENT_LANE_CLASSNAME } from "@/components/app-content-lane";
import { cn } from "@/lib/utils";

export function AppFrame({
  children,
  className,
  centered = false
}: {
  children: ReactNode;
  className?: string;
  centered?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div
        className={cn(
          `${APP_CONTENT_LANE_CLASSNAME} flex min-h-dvh flex-col py-6 sm:py-8 lg:py-12`,
          centered && "justify-center",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
