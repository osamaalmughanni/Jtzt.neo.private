import { toast as sonnerToast } from "sonner";

export function toast(input: { title: string; description?: string }) {
  return sonnerToast(input.title, {
    description: input.description
  });
}
