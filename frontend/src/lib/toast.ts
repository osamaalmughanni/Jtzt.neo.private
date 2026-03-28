import { createElement } from "react";
import { toast as sonnerToast } from "sonner";
import { describeApiError } from "./api";

export function toast(input: { title: string; description?: string | ReturnType<typeof createElement> }) {
  const description =
    typeof input.description === "string" && (input.description.includes("\n") || input.description.startsWith("{") || input.description.startsWith("["))
      ? createElement(
          "pre",
          {
            className:
              "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-3 font-mono text-[11px] leading-4 text-foreground",
          },
          input.description,
        )
      : input.description;

  return sonnerToast(input.title, {
    description
  });
}

export function toastError(input: { title: string; error: unknown; fallback?: string }) {
  const description = describeApiError(input.error, input.fallback);
  return toast({ title: input.title, description });
}
