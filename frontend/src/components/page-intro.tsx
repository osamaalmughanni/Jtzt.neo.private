import type { ReactNode } from "react";
import { Stack } from "@/components/stack";
import { cn } from "@/lib/utils";

export function PageIntro({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Stack gap="md" className={cn("w-full", className)}>
      {children}
    </Stack>
  );
}
