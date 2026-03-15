import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

export function FormPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function FormPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-6 rounded-2xl border border-border bg-card p-5", className)}>{children}</div>;
}

export function FormSection({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function FormFields({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-foreground">{children}</span>;
}

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

export function FieldSelect(props: ComponentPropsWithoutRef<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={cn("flex h-10 w-full rounded-md border border-input bg-[hsl(var(--input))] px-3 py-2 text-sm", className)}
      {...rest}
    />
  );
}

export function FieldCombobox({
  label,
  value,
  onValueChange,
  items,
  placeholder,
  disabled,
  className
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const normalizedLabel = label.trim().toLowerCase();

  return (
    <Combobox
      value={value}
      onValueChange={onValueChange}
      options={items}
      placeholder={placeholder ?? `Select ${normalizedLabel}`}
      searchPlaceholder={`Search ${normalizedLabel}`}
      emptyText={`No ${normalizedLabel} found.`}
      disabled={disabled}
      className={className}
    />
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex justify-end gap-2 pt-1", className)}>{children}</div>;
}
