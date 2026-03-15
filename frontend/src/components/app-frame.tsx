import type { ReactNode } from "react";
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
    <div className="min-h-screen bg-background text-foreground">
      <div
        className={cn(
          "mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-12",
          centered && "justify-center",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
