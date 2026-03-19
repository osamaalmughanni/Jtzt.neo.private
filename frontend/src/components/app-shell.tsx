import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { AppFooter } from "@/components/app-footer";
import { AppHeader, type HeaderAction } from "@/components/app-header";
import { AppHeaderLoadingBar } from "@/components/app-header-loading-bar";
import { AppHeaderStateProvider, useAppHeaderState } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { Stack } from "@/components/stack";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LockSimple } from "phosphor-react";

interface AppShellProps {
  mode: "company" | "admin";
}

export function AppShell({ mode }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { companyIdentity, companySession, lockTablet } = useAuth();
  const [tabletIdleTimeoutSeconds, setTabletIdleTimeoutSeconds] = useState(10);
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
  const tabletActions: HeaderAction[] | undefined =
    companySession?.accessMode === "tablet"
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
      : undefined;

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
    <AppFrame>
      <AppHeaderStateProvider>
        <ShellContent
          firstRouteRef={firstRouteRef}
          locationKey={`${location.pathname}${location.search}${location.hash}`}
          menuTo={menuTo}
          scope={scope}
          tabletActions={tabletActions}
        />
      </AppHeaderStateProvider>
    </AppFrame>
  );
}

function ShellContent({
  firstRouteRef,
  locationKey,
  menuTo,
  scope,
  tabletActions,
}: {
  firstRouteRef: React.MutableRefObject<boolean>;
  locationKey: string;
  menuTo?: string;
  scope: "company" | "admin" | "tablet";
  tabletActions?: HeaderAction[];
}) {
  const { startLoading, stopLoading } = useAppHeaderState();

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

  return (
    <Stack gap="md" className="flex-1">
      <AppHeader menuTo={menuTo} actions={tabletActions} scope={scope} />
      <AppHeaderLoadingBar />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <AppFooter context="app" />
    </Stack>
  );
}
