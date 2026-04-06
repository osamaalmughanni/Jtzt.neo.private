import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Icon } from "phosphor-react";
import { AppHeader } from "@/components/app-header";
import { AppHeaderLoadingBar } from "@/components/app-header-loading-bar";
import { AppHeaderStateProvider, useAppHeaderState } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { AppContentLane } from "@/components/app-content-lane";
import { AppRouteLoadingState } from "@/components/page-load-state";
import { ShellScaffold, SHELL_FRAME_CLASSNAME } from "@/components/shell-scaffold";
import { useFullscreenFooterActions } from "@/hooks/use-fullscreen-footer-actions";
import { useCompanySettings } from "@/lib/company-settings";
import { useAuth } from "@/lib/auth";
import { LockSimple, SignOut } from "phosphor-react";

interface AppShellProps {
  mode: "company" | "admin";
}

export function AppShell({ mode }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = location.pathname;
  const { companyIdentity, companySession, logoutAdmin } = useAuth();
  const { settings, loading: settingsLoading } = useCompanySettings();
  const shouldBlockCompanyShell = mode === "company" && companySession && (!settings || settingsLoading);
  const [tabletIdleTimeoutSeconds, setTabletIdleTimeoutSeconds] = useState(10);
  const idleTimerRef = useRef<number | null>(null);
  const firstRouteRef = useRef(true);
  const footerActions = useFullscreenFooterActions();
  const menuTo =
    mode === "admin"
      ? undefined
      : companySession?.accessMode === "tablet"
        ? undefined
      : companyIdentity?.user.role === "admin"
        ? "/menu"
        : "/menu";
  const scope = mode === "company" && companySession?.accessMode === "tablet" ? "tablet" : mode;

  const transitionToTabletPin = useCallback(() => {
    navigate("/tablet/pin", { replace: true, state: { lockTablet: true } });
  }, [navigate]);

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

  const headerActions =
    mode === "admin"
      ? [
          {
            key: "admin-sign-out",
            label: "Sign out",
            icon: SignOut,
            onClick: () => {
              logoutAdmin();
              navigate("/?mode=admin", { replace: true });
            }
          }
        ]
      : companySession?.accessMode === "tablet"
      ? [
          {
            key: "lock-tablet",
            label: "Lock tablet",
            icon: LockSimple,
            onClick: () => {
              transitionToTabletPin();
            }
          }
        ]
      : undefined;

  useEffect(() => {
    if (companySession?.accessMode !== "tablet") {
      setTabletIdleTimeoutSeconds(10);
      return;
    }

    setTabletIdleTimeoutSeconds(settings?.tabletIdleTimeoutSeconds ?? 10);
  }, [companySession, settings?.tabletIdleTimeoutSeconds]);

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
        transitionToTabletPin();
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
  }, [companySession, tabletIdleTimeoutSeconds, transitionToTabletPin]);

  if (shouldBlockCompanyShell) {
    return <AppRouteLoadingState />;
  }

  return (
    <AppFrame appShell>
      <AppHeaderStateProvider>
        <ShellContent
          key={locationKey}
          headerActions={headerActions}
          footerActions={footerActions}
          firstRouteRef={firstRouteRef}
          locationKey={locationKey}
          menuTo={menuTo}
          scope={scope}
        />
      </AppHeaderStateProvider>
    </AppFrame>
  );
}

function ShellContent({
  headerActions,
  footerActions,
  firstRouteRef,
  locationKey,
  menuTo,
  scope,
}: {
  headerActions?: Array<{
    key: string;
    label: string;
    icon: Icon;
    onClick: () => void;
  }>;
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
  const { bottomBar, bottomBarKey, startLoading, stopLoading } = useAppHeaderState();
  const [isRouteChromePending, setIsRouteChromePending] = useState(true);

  useEffect(() => {
    setIsRouteChromePending(true);

    if (firstRouteRef.current) {
      firstRouteRef.current = false;
      const timeout = window.setTimeout(() => {
        setIsRouteChromePending(false);
      }, 360);
      return () => {
        window.clearTimeout(timeout);
      };
    }

    startLoading();
    const timeout = window.setTimeout(() => {
      stopLoading();
      setIsRouteChromePending(false);
    }, 320);

    return () => {
      window.clearTimeout(timeout);
      stopLoading();
    };
  }, [firstRouteRef, locationKey, startLoading, stopLoading]);

  return (
    <div className={SHELL_FRAME_CLASSNAME}>
      <AppHeaderLoadingBar />
      <ShellScaffold
        routeKey={locationKey}
        header={<AppHeader menuTo={menuTo} scope={scope} actions={headerActions} />}
        footerActions={footerActions}
        forceBottomFade={isRouteChromePending}
        bottomSlot={
          <AnimatePresence initial={false} mode="wait">
            {bottomBar ? (
              <motion.div
                key={bottomBarKey ?? "bottom-bar"}
                className="relative z-20"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{
                  type: "tween",
                  duration: 0.16,
                  ease: "easeOut",
                }}
                style={{ willChange: "transform,opacity" }}
              >
                <div className="py-3">
                  <AppContentLane>{bottomBar}</AppContentLane>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        }
      >
        <Outlet />
      </ShellScaffold>
    </div>
  );
}
