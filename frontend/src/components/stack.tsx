import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const stackVariants = cva("flex flex-col", {
  variants: {
    gap: {
      none: "gap-0",
      xs: "gap-1.5",
      sm: "gap-3",
      md: "gap-4",
      lg: "gap-6",
      xl: "gap-7",
    }
  },
  defaultVariants: {
    gap: "md"
  }
});

export interface StackProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof stackVariants> {}

export function Stack({ className, gap, ...props }: StackProps) {
  return <div className={cn(stackVariants({ gap }), className)} {...props} />;
}
