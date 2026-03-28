import { RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CaptchaProps = {
  challenge: string;
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  label: string;
  description: string;
  placeholder: string;
  refreshLabel: string;
  error?: string;
  disabled?: boolean;
};

export function Captcha({
  challenge,
  value,
  onChange,
  onRefresh,
  label,
  description,
  placeholder,
  refreshLabel,
  error,
  disabled = false,
}: CaptchaProps) {
  const accentSeeds = [-4, 3, -2, 4, -3, 2, -1, 3];

  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-2.5 text-xs"
          onClick={onRefresh}
          disabled={disabled}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {refreshLabel}
        </Button>
      </div>

      <div className="relative mt-4 rounded-xl border border-border bg-background px-4 py-6">
        <div className="absolute inset-0 opacity-70">
          <span className="absolute left-[8%] top-[24%] h-16 w-16 rounded-full bg-foreground/5 blur-2xl" />
          <span className="absolute right-[14%] top-[10%] h-14 w-14 rounded-full bg-foreground/5 blur-2xl" />
          <span className="absolute bottom-[8%] left-[28%] h-12 w-12 rounded-full bg-foreground/5 blur-2xl" />
        </div>
        <div className="relative flex flex-wrap items-center justify-center gap-2 px-2 select-none">
          {challenge.split("").map((char, index) => (
            <span
              key={`${char}-${index}`}
              className={cn(
                "inline-flex min-h-11 min-w-9 items-center justify-center rounded-lg border border-border/70 bg-card px-2 py-1 font-mono text-lg font-semibold text-foreground shadow-sm",
                index % 2 === 0 ? "translate-y-[-1px]" : "translate-y-[1px]"
              )}
              style={{
                transform: `rotate(${accentSeeds[index % accentSeeds.length]}deg)`,
              }}
            >
              {char}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          disabled={disabled}
          className="h-11 border-border/70 bg-background shadow-none"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
