import * as React from "react";
import { FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FilePickerProps = {
  label: string;
  noSelectionLabel: string;
  multipleSelectionLabel: string;
  buttonLabel: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
};

export const FilePicker = React.forwardRef<HTMLInputElement, FilePickerProps>(
  ({ label, noSelectionLabel, multipleSelectionLabel, buttonLabel, files, onFilesChange, accept, multiple, className }, forwardedRef) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const inputId = React.useId();

    React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      onFilesChange(Array.from(event.currentTarget.files ?? []));
    }

    function openPicker() {
      inputRef.current?.click();
    }

    const selectedLabel =
      files.length === 0
        ? noSelectionLabel
        : files.length === 1
          ? files[0]?.name ?? noSelectionLabel
          : multipleSelectionLabel.replace("{{count}}", String(files.length));

    return (
      <div className={cn("flex w-full items-stretch gap-2", className)}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={handleChange}
          aria-label={label}
        />
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
          <FileText className="h-4 w-4 shrink-0" />
          <span className={cn("min-w-0 truncate text-sm leading-none", files.length > 0 ? "text-foreground" : "text-muted-foreground")}>{selectedLabel}</span>
          {files.length > 1 ? (
            <Badge variant="secondary" className="ml-auto h-5 shrink-0 px-2 text-[11px] tabular-nums">
              {files.length}
            </Badge>
          ) : null}
        </div>
        <Button type="button" variant="outline" className="h-10 shrink-0 gap-2 px-3 text-sm" onClick={openPicker}>
          <Upload className="h-4 w-4" />
          <span className="whitespace-nowrap">{buttonLabel}</span>
        </Button>
      </div>
    );
  }
);

FilePicker.displayName = "FilePicker";
