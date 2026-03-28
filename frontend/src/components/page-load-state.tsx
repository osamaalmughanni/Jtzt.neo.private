import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAppHeaderState } from "@/components/app-header-state";
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
  return (
    <div className={cn("flex w-full flex-1 flex-col items-center justify-center gap-5 bg-black", minHeightClassName, className)}>
      <img
        alt="Jtzt"
        aria-hidden="true"
        className="h-auto w-32 select-none opacity-100"
        draggable={false}
        src="/logo.svg"
      />
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
    return <div className={cn("flex min-h-full flex-1 flex-col", className)} aria-hidden="true" />;
  }

  return (
    <Stack gap={gap} className={cn("min-h-full flex-1", className)}>
      {intro}
      {children}
    </Stack>
  );
}
