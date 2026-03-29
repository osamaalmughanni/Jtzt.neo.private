import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAppHeaderState } from "@/components/app-header-state";
import { Logo } from "@/components/logo";
import { Stack } from "@/components/stack";
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
  void label;
  void className;
  void minHeightClassName;
  return null;
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
    void skeleton;
    return null;
  }

  return (
    <Stack gap={gap} className={cn("min-h-0 flex-1", className)}>
      {intro}
      {children}
    </Stack>
  );
}
