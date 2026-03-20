import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAppHeaderState } from "@/components/app-header-state";
import { Stack } from "@/components/stack";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function AppRouteLoadingState() {
  return (
    <div className="flex min-h-dvh w-full bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 px-5 py-6 sm:px-8">
        <PageLoadingState className="flex-1" />
      </div>
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
    <div className={cn("flex w-full flex-1 items-center justify-center", minHeightClassName, className)}>
      <Spinner className="size-7" />
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
    return <div className={cn("flex min-h-full flex-1 flex-col", className)} aria-hidden="true" />;
  }

  return (
    <Stack gap={gap} className={cn("min-h-full flex-1", className)}>
      {intro}
      {children}
    </Stack>
  );
}
