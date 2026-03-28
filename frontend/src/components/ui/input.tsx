import * as React from "react";
import { cn } from "@/lib/utils";

export const inputBaseClassName =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground transition-[color,background-color,border-color,box-shadow] duration-150 ease-out file:mr-4 file:inline-flex file:h-8 file:cursor-pointer file:items-center file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none cursor-pointer";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      className={cn(inputBaseClassName, className)}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";
