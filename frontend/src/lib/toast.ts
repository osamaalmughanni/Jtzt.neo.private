import { createElement } from "react";
import { toast as sonnerToast } from "sonner";
import { describeApiError } from "./api";

export function toast(input: { title: string; description?: string | ReturnType<typeof createElement> }) {
  return sonnerToast(input.title, {
    description: input.description
  });
}

export function toastError(input: { title: string; error: unknown; fallback?: string }) {
  const description = describeApiError(input.error, input.fallback);
  return toast({
    title: input.title,
    description: createElement("div", { className: "space-y-2" }, [
      createElement("p", { key: "summary", className: "whitespace-pre-wrap break-words text-xs leading-5" }, description),
    ]),
  });
}
