import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import type { Icon } from "phosphor-react";
import { AppContentLane } from "@/components/app-content-lane";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { AppHeaderLoadingBar } from "@/components/app-header-loading-bar";
import { AppHeaderStateProvider, useAppHeaderState } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { ArrowsIn, ArrowsOut, LockSimple } from "phosphor-react";

interface AppShellProps {
  mode: "company" | "admin";
}

export function AppShell({ mode }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { companyIdentity, companySession, lockTablet } = useAuth();
  const [tabletIdleTimeoutSeconds, setTabletIdleTimeoutSeconds] = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const firstRouteRef = useRef(true);
  const menuTo =
    mode === "admin"
      ? "/admin/menu"
      : companySession?.accessMode === "tablet"
        ? undefined
        : companyIdentity?.user.role === "admin"
        ? "/menu"
        : "/menu";
  const scope = mode === "company" && companySession?.accessMode === "tablet" ? "tablet" : mode;
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.dataset.appShell = "true";
    body.dataset.appShell = "true";

    return () => {
      delete root.dataset.appShell;
      delete body.dataset.appShell;
    };
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
    };
  }, []);

  const footerActions = [
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
      }
    },
    ...(companySession?.accessMode === "tablet"
      ? [
          {
            key: "lock-tablet",
            label: "Lock tablet",
            icon: LockSimple,
            onClick: () => {
              lockTablet();
              navigate("/tablet/pin", { replace: true });
            }
          }
        ]
      : []),
  ];

  useEffect(() => {
    if (companySession?.accessMode !== "tablet") {
      return;
    }

    void api
      .getSettings(companySession.token)
      .then((response) => setTabletIdleTimeoutSeconds(response.settings.tabletIdleTimeoutSeconds))
      .catch(() => setTabletIdleTimeoutSeconds(10));
  }, [companySession]);

  useEffect(() => {
    if (companySession?.accessMode !== "tablet") {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    const timeoutMs = Math.max(0, tabletIdleTimeoutSeconds) * 1000;
    if (timeoutMs === 0) {
      return;
    }

    const restartTimer = () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = window.setTimeout(() => {
        lockTablet();
        navigate("/tablet/pin", { replace: true });
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
    restartTimer();
    for (const eventName of events) {
      window.addEventListener(eventName, restartTimer, { passive: true });
    }

    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      for (const eventName of events) {
        window.removeEventListener(eventName, restartTimer);
      }
    };
  }, [companySession, lockTablet, navigate, tabletIdleTimeoutSeconds]);

  return (
    <AppFrame appShell>
      <AppHeaderStateProvider>
        <ShellContent
          footerActions={footerActions}
          firstRouteRef={firstRouteRef}
          locationKey={`${location.pathname}${location.search}${location.hash}`}
          menuTo={menuTo}
          scope={scope}
        />
      </AppHeaderStateProvider>
    </AppFrame>
  );
}

function ShellContent({
  footerActions,
  firstRouteRef,
  locationKey,
  menuTo,
  scope,
}: {
  footerActions: Array<{
    key: string;
    label: string;
    icon: Icon;
    onClick: () => void;
  }>;
  firstRouteRef: React.MutableRefObject<boolean>;
  locationKey: string;
  menuTo?: string;
  scope: "company" | "admin" | "tablet";
}) {
  const { bottomBar, startLoading, stopLoading } = useAppHeaderState();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (firstRouteRef.current) {
      firstRouteRef.current = false;
      return;
    }

    startLoading();
    const timeout = window.setTimeout(() => {
      stopLoading();
    }, 320);

    return () => {
      window.clearTimeout(timeout);
      stopLoading();
    };
  }, [firstRouteRef, locationKey, startLoading, stopLoading]);

  useEffect(() => {
    scrollAreaRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [locationKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
      <AppHeaderLoadingBar />
      <AppContentLane>
        <AppHeader menuTo={menuTo} scope={scope} />
      </AppContentLane>
      <main className="flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
        <div ref={scrollAreaRef} className="app-scroll-area flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-auto overscroll-contain pt-4 pb-4">
          <AppContentLane className="flex min-h-full flex-1 flex-col">
            <Outlet />
          </AppContentLane>
        </div>
      </main>
      {bottomBar ? <AppContentLane className="pt-3 pb-4">{bottomBar}</AppContentLane> : null}
      <AppContentLane>
        <AppFooter context="app" actions={footerActions} />
      </AppContentLane>
    </div>
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
