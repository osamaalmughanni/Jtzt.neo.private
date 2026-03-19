import type { ReactNode } from "react";
import { Stack } from "@/components/stack";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function AppRouteLoadingState() {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 px-5 py-6 sm:px-8">
        <PageLoadingState className="flex-1" label="Loading session..." />
      </div>
    </div>
  );
}

export function PageLoadingState({
  label = "Loading...",
  className,
  minHeightClassName = "min-h-[24rem]",
}: {
  label?: string;
  className?: string;
  minHeightClassName?: string;
}) {
  return (
    <div className={cn("flex w-full flex-1 items-center justify-center", minHeightClassName, className)}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-background/80 shadow-sm backdrop-blur">
          <Spinner className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function PageLoadingOverlay({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
      <div className="mt-2 rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-3.5" />
          {label}
        </span>
      </div>
    </div>
  );
}

export function PageLoadBoundary({
  loading,
  refreshing,
  skeleton,
  children,
  overlayLabel,
  className,
  gap = "xl",
}: {
  loading: boolean;
  refreshing?: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  overlayLabel?: string;
  className?: string;
  gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
}) {
  if (loading) {
    return <Stack gap={gap} className={cn("min-h-full flex-1", className)}>{skeleton}</Stack>;
  }

  return (
    <Stack gap={gap} className={cn("relative min-h-full flex-1", className)}>
      {refreshing ? <PageLoadingOverlay label={overlayLabel} /> : null}
      {children}
    </Stack>
  );
}
