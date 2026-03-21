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
      // ignore unsupported environments
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
  }, [isFullscreen, requestWakeLock]);

  const handleFullscreenToggle = useCallback(() => {
    void toggleFullscreen()
      .catch((error) => {
        toast({
          title: "Fullscreen unavailable",
          description: error instanceof Error ? error.message : "This browser or device blocked fullscreen mode.",
        });
      });
  }, []);

  return useMemo(
    () => [
      {
        key: "toggle-fullscreen",
        label: isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
        icon: isFullscreen ? ArrowsIn : ArrowsOut,
        onClick: handleFullscreenToggle,
      },
    ],
    [handleFullscreenToggle, isFullscreen],
  );
}

async function requestElementFullscreen(element: HTMLElement) {
  const normalized = element as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  if (element.requestFullscreen) {
    try {
      await element.requestFullscreen({ navigationUI: "hide" });
      return;
    } catch {
      await element.requestFullscreen();
      return;
    }
  }
  if (normalized.webkitRequestFullscreen) {
    await normalized.webkitRequestFullscreen();
    return;
  }
  if (normalized.msRequestFullscreen) {
    await normalized.msRequestFullscreen();
    return;
  }
  throw new Error("This browser or embedded webview does not allow fullscreen mode.");
}

async function exitElementFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };

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

async function toggleFullscreen() {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement;
  const root = document.documentElement as HTMLElement;

  if (fullscreenElement) {
    await exitElementFullscreen();
    return;
  }

  await requestElementFullscreen(root);
}
