import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { AppFooter } from "@/components/app-footer";
import { AppHeader, type HeaderAction } from "@/components/app-header";
import { AppHeaderStateProvider } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LockSimple } from "phosphor-react";

interface AppShellProps {
  mode: "company" | "admin";
}

export function AppShell({ mode }: AppShellProps) {
  const navigate = useNavigate();
  const { companyIdentity, companySession, lockTablet } = useAuth();
  const [tabletIdleTimeoutSeconds, setTabletIdleTimeoutSeconds] = useState(10);
  const idleTimerRef = useRef<number | null>(null);
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
        <div className="flex flex-1 flex-col gap-4">
          <AppHeader menuTo={menuTo} actions={tabletActions} scope={scope} />
          <main className="flex-1">
            <Outlet />
          </main>
          <AppFooter context="app" />
        </div>
      </AppHeaderStateProvider>
    </AppFrame>
  );
}
