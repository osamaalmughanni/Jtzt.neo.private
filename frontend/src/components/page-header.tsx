import { cn } from "@/lib/utils";
import { PageLabel, type PageLabelProps } from "./page-label";

export function PageHeader({ className, ...props }: PageLabelProps) {
  return (
    <div className={cn("mb-6 w-full", className)}>
      <PageLabel {...props} />
    </div>
  );
}
