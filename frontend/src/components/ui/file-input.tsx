import * as React from "react";
import { FileText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputBaseClassName } from "@/components/ui/input";

type FileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  file?: File | null;
  fileName?: string;
  placeholder?: string;
  buttonLabel?: string;
  onFileChange?: (file: File | null) => void;
};

export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ className, file, fileName, placeholder = "Choose a file", buttonLabel = "Browse", onFileChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const inputId = React.useId();

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      onFileChange?.(event.target.files?.[0] ?? null);
    }

    return (
      <label htmlFor={inputId} className={cn(inputBaseClassName, "min-h-10 cursor-pointer items-center justify-between gap-3 py-1.5", className)}>
        <input
          {...props}
          id={inputId}
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", file || fileName ? "text-foreground" : "text-muted-foreground")}>
            {file?.name ?? fileName ?? placeholder}
          </span>
        </div>
        <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium text-foreground">
          <Upload className="h-3.5 w-3.5" />
          {buttonLabel}
        </span>
      </label>
    );
  }
);

FileInput.displayName = "FileInput";
