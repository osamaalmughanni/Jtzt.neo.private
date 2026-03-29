import type { ReactNode } from "react";
import { useEffect } from "react";
import { CircleNotch } from "phosphor-react";
import { useAppHeaderState } from "@/components/app-header-state";
import { Logo } from "@/components/logo";
import { Stack } from "@/components/stack";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function AppRouteLoadingState() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-black">
      <PageLoadingState className="flex-1 bg-black" />
    </div>
  );
}

export function PageLoadingState({
  label,
  className,
  minHeightClassName = "min-h-[24rem]",
}: {
  label?: string;
  className?: string;
  minHeightClassName?: string;
}) {
  return (
    <div className={cn("flex w-full flex-1 flex-col items-center justify-center gap-5 bg-black", minHeightClassName, className)}>
      <Logo size={128} tone="light" />
      {label ? <p className="text-sm tracking-wide text-white/70">{label}</p> : null}
    </div>
  );
}

export function PageLoadBoundary({
  intro,
  loading,
  refreshing,
  skeleton,
  children,
  className,
  gap = "xl",
}: {
  intro?: ReactNode;
  loading: boolean;
  refreshing?: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
  gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
}) {
  const { startLoading, stopLoading } = useAppHeaderState();

  useEffect(() => {
    if (!loading) {
      return;
    }

    startLoading();

    return () => {
      stopLoading();
    };
  }, [loading, startLoading, stopLoading]);

  useEffect(() => {
    if (!refreshing) {
      return;
    }

    startLoading();

    return () => {
      stopLoading();
    };
  }, [refreshing, startLoading, stopLoading]);

  if (loading) {
    if (skeleton) {
      return <>{skeleton}</>;
    }

    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center", className)} aria-hidden="true">
        <Badge variant="outline" className="inline-flex h-8 items-center gap-1 rounded-full border-border/70 bg-muted/40 px-2.5 text-[12px] font-medium text-muted-foreground">
          <CircleNotch size={13} weight="bold" className="shrink-0 animate-spin text-current" />
          <span className="whitespace-nowrap">Loading</span>
        </Badge>
      </div>
    );
  }

  return (
    <Stack gap={gap} className={cn("min-h-0 flex-1", className)}>
      {intro}
      {children}
    </Stack>
  );
}
