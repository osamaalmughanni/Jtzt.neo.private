import type { ReactNode } from "react";
import { useEffect } from "react";
import { motion } from "framer-motion";
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
    return <div className={cn("flex min-h-full flex-1 flex-col", className)} aria-hidden="true" />;
  }

  return (
    <motion.div
      className={cn("min-h-full flex-1", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
      style={{ willChange: "opacity" }}
    >
      <Stack gap={gap} className="min-h-full flex-1">
        {intro}
        {children}
      </Stack>
    </motion.div>
  );
}
