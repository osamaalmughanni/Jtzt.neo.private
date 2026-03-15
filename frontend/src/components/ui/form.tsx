import * as React from "react";
import { Controller, FormProvider, useFormContext, type ControllerProps, type FieldPath, type FieldValues } from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export const Form = FormProvider;

const FormFieldContext = React.createContext<{ name: string }>({ name: "" });

export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(
  props: ControllerProps<TFieldValues, TName>
) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

export function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export function FormLabel(props: React.ComponentPropsWithoutRef<typeof Label>) {
  return <Label {...props} />;
}

export function FormControl({ children }: { children: React.ReactElement }) {
  const { name } = React.useContext(FormFieldContext);
  const { formState } = useFormContext();
  const hasError = Boolean(formState.errors[name]);
  return React.cloneElement(children, {
    "aria-invalid": hasError
  });
}

export function FormMessage() {
  const { name } = React.useContext(FormFieldContext);
  const {
    formState: { errors }
  } = useFormContext();

  const message = errors[name]?.message;
  if (!message || typeof message !== "string") {
    return null;
  }

  return <p className="text-sm text-foreground">{message}</p>;
}
