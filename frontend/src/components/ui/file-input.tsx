import * as React from "react";
import { FileText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputBaseClassName } from "@/components/ui/input";

type FileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  file?: File | null;
  placeholder?: string;
  buttonLabel?: string;
  onFileChange?: (file: File | null) => void;
};

export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ className, file, placeholder = "Choose a file", buttonLabel = "Browse", onFileChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    function handlePick() {
      inputRef.current?.click();
    }

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      onFileChange?.(event.target.files?.[0] ?? null);
    }

    return (
      <div className={cn(inputBaseClassName, "min-h-10 cursor-pointer items-center justify-between gap-3 py-1.5", className)} onClick={handlePick} role="button" tabIndex={0} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePick();
        }
      }}>
        <input
          {...props}
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", file ? "text-foreground" : "text-muted-foreground")}>
            {file?.name ?? placeholder}
          </span>
        </div>
        <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium text-foreground">
          <Upload className="h-3.5 w-3.5" />
          {buttonLabel}
        </span>
      </div>
    );
  }
);

FileInput.displayName = "FileInput";
