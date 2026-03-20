import { LoaderCircleIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className, ...props }: ComponentProps<"svg"> & { spinning?: boolean }) {
  const { spinning = true, ...rest } = props;

  return (
    <LoaderCircleIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 text-muted-foreground", spinning && "animate-spin", className)}
      {...rest}
    />
  );
}
