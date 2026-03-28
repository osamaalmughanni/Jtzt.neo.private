import { RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
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

      <div className="relative mt-4 overflow-hidden rounded-xl border border-border bg-background px-3 py-5 sm:px-4 sm:py-6">
        <div className="absolute inset-0 opacity-70">
          <span className="absolute left-[8%] top-[24%] h-16 w-16 rounded-full bg-foreground/5 blur-2xl" />
          <span className="absolute right-[14%] top-[10%] h-14 w-14 rounded-full bg-foreground/5 blur-2xl" />
          <span className="absolute bottom-[8%] left-[28%] h-12 w-12 rounded-full bg-foreground/5 blur-2xl" />
          <span className="absolute inset-x-0 top-1/2 h-px bg-foreground/5" />
        </div>
        <div className="relative flex min-w-0 flex-nowrap items-center justify-center gap-[clamp(0.1rem,0.6vw,0.3rem)] overflow-hidden px-1 select-none whitespace-nowrap">
          {challenge.split("").map((char, index) => (
            <motion.span
              key={`${char}-${index}`}
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card px-[clamp(0.3rem,0.9vw,0.5rem)] py-[clamp(0.25rem,0.6vw,0.38rem)] font-mono font-semibold text-foreground",
                "text-[clamp(0.84rem,2vw,1.12rem)] shadow-sm",
              )}
              initial={false}
              animate={{
                y: index % 2 === 0 ? -1 : 1,
                rotate: accentSeeds[index % accentSeeds.length],
              }}
              transition={{
                y: { duration: 0.2, ease: "easeOut" },
                rotate: { duration: 0.25, ease: "easeOut" },
              }}
            >
              {char}
            </motion.span>
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
