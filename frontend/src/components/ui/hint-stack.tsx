import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HintStack({
  messages,
  className,
}: {
  messages: Array<ReactNode>;
  className?: string;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={cn("flex flex-col gap-1 text-xs leading-5 text-muted-foreground", className)}
      role="status"
    >
      {messages.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
    </div>
  );
}
