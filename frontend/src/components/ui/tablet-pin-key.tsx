import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabletPinKeyProps {
  children: ReactNode;
  muted?: boolean;
  onClick: () => void;
  className?: string;
}

export function TabletPinKey({ children, muted = false, onClick, className }: TabletPinKeyProps) {
  return (
    <div className={cn("relative aspect-square w-full", className)}>
      <div
        className="absolute inset-0 rounded-full shadow-lg"
        style={{
          backgroundColor: "hsl(var(--muted) / 0.92)",
          boxShadow: "0 10px 30px hsl(var(--background) / 0.4)",
        }}
      />
      <button
        type="button"
        onPointerDown={() => {
          if (navigator.vibrate && window.isSecureContext && navigator.userActivation?.isActive) {
            navigator.vibrate(10);
          }
        }}
        onClick={onClick}
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full bg-transparent transition-transform active:scale-95",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        <span
          className={cn(
            "block leading-none text-center",
            muted
              ? "text-[clamp(1rem,2.4vmin,1.15rem)] font-semibold"
              : "font-bold tracking-[-0.04em] text-[clamp(3rem,7.2vmin,4.8rem)]"
          )}
        >
          {children}
        </span>
      </button>
    </div>
  );
}
