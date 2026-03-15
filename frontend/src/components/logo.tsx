import type { CSSProperties } from "react";
import rawLogo from "@shared/img/logo.svg?raw";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const sanitizedLogo = rawLogo
  .replace(/<\?xml[\s\S]*?\?>/i, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<svg\b/, '<svg preserveAspectRatio="xMidYMid meet"')
  .trim();

export function Logo({
  size = 72,
  className,
  tone = "auto"
}: {
  size?: number | string;
  className?: string;
  tone?: "auto" | "light" | "dark";
}) {
  const { theme } = useTheme();
  const style: CSSProperties =
    typeof size === "number"
      ? {
          width: size,
          height: "auto"
        }
      : {
          width: size,
          height: "auto"
        };
  const resolvedTone = tone === "auto" ? theme : tone;

  return (
    <span
      aria-label="Jtzt logo"
      role="img"
      style={style}
      className={cn(
        "inline-block shrink-0 leading-none",
        "[&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:transition-[filter] [&>svg]:duration-200",
        resolvedTone === "dark" ? "[&>svg]:invert" : null,
        className
      )}
      dangerouslySetInnerHTML={{ __html: sanitizedLogo }}
    />
  );
}
