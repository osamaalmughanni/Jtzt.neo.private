import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabletPinKeyProps {
  children: ReactNode;
  muted?: boolean;
  onPress: () => void;
  className?: string;
  disabled?: boolean;
}

function triggerHapticFeedback() {
  const userActivation = navigator.userActivation;
  const hasTouchSupport = navigator.maxTouchPoints > 0;

  if (navigator.vibrate && window.isSecureContext && hasTouchSupport && userActivation?.isActive) {
    navigator.vibrate(10);
  }
}

export function TabletPinKey({ children, muted = false, onPress, className, disabled = false }: TabletPinKeyProps) {
  const [pressed, setPressed] = useState(false);

  function releasePressState() {
    setPressed(false);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    setPressed(true);
    triggerHapticFeedback();
    onPress();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || event.repeat) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setPressed(true);
    triggerHapticFeedback();
    onPress();
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setPressed(false);
    }
  }

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
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={releasePressState}
        onPointerCancel={releasePressState}
        onPointerLeave={releasePressState}
        onBlur={releasePressState}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={(event) => event.preventDefault()}
        className={cn(
          "absolute inset-0 flex touch-none select-none items-center justify-center rounded-full bg-transparent transition-transform duration-75 ease-out disabled:pointer-events-none disabled:cursor-default disabled:opacity-70",
          pressed ? "scale-[0.94]" : "scale-100",
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
