import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsIn, ArrowsOut } from "phosphor-react";
import { toast } from "@/lib/toast";

type FooterAction = {
  key: string;
  label: string;
  icon: typeof ArrowsIn;
  onClick: () => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

export function useFullscreenFooterActions(): FooterAction[] {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const wakeLockHeld = useCallback(() => wakeLockRef.current !== null, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock?.request || wakeLockHeld()) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // best-effort; ignore failures in unsupported environments
    }
  }, [wakeLockHeld]);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      msFullscreenElement?: Element | null;
    };
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState as EventListener);
    document.addEventListener("MSFullscreenChange", syncFullscreenState as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState as EventListener);
      document.removeEventListener("MSFullscreenChange", syncFullscreenState as EventListener);
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    if (isFullscreen) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isFullscreen, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isFullscreen) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isFullscreen]);

  return useMemo(
    () => [
      {
        key: "toggle-fullscreen",
        label: isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
        icon: isFullscreen ? ArrowsIn : ArrowsOut,
        onClick: () => {
          void toggleFullscreen().catch((error) => {
            toast({
              title: "Fullscreen unavailable",
              description: error instanceof Error ? error.message : "This browser or device blocked fullscreen mode.",
            });
          });
        },
      },
    ],
    [isFullscreen],
  );
}

async function toggleFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement;

  if (fullscreenElement) {
    if (doc.exitFullscreen) {
      await doc.exitFullscreen();
      return;
    }
    if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      return;
    }
    if (doc.msExitFullscreen) {
      await doc.msExitFullscreen();
      return;
    }
    throw new Error("This browser does not expose a compatible fullscreen exit API.");
  }

  if (root.requestFullscreen) {
    try {
      await root.requestFullscreen({ navigationUI: "hide" });
      return;
    } catch {
      await root.requestFullscreen();
      return;
    }
  }
  if (root.webkitRequestFullscreen) {
    await root.webkitRequestFullscreen();
    return;
  }
  if (root.msRequestFullscreen) {
    await root.msRequestFullscreen();
    return;
  }

  throw new Error("This browser or embedded webview does not allow fullscreen mode.");
}
