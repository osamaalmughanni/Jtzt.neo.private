import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { describeApiError } from "./api";

export function toast(input: { title: string; description?: string | ReactNode }) {
  return sonnerToast(input.title, {
    description: input.description,
  });
}

export function toastError(input: { title: string; error: unknown; fallback?: string }) {
  const description = describeApiError(input.error, input.fallback);
  return toast({ title: input.title, description });
}
