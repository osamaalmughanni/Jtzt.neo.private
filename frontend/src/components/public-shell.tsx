import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { HeaderAction } from "@/components/app-header";
import { AppHeader } from "@/components/app-header";
import { AppHeaderLoadingBar } from "@/components/app-header-loading-bar";
import { AppHeaderStateProvider } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { ShellScaffold, SHELL_FRAME_CLASSNAME } from "@/components/shell-scaffold";
import { useFullscreenFooterActions } from "@/hooks/use-fullscreen-footer-actions";

export function PublicShell({
  actions,
  children,
}: {
  actions?: HeaderAction[];
  children: ReactNode;
}) {
  const location = useLocation();

  return (
    <AppFrame appShell>
      <AppHeaderStateProvider>
        <PublicShellContent
          key={location.pathname}
          actions={actions}
        >
          {children}
        </PublicShellContent>
      </AppHeaderStateProvider>
    </AppFrame>
  );
}

function PublicShellContent({
  actions,
  children,
}: {
  actions?: HeaderAction[];
  children: ReactNode;
}) {
  const location = useLocation();
  const footerActions = useFullscreenFooterActions();

  return (
    <div className={SHELL_FRAME_CLASSNAME}>
      <AppHeaderLoadingBar />
      <ShellScaffold
        routeKey={location.pathname}
        header={<AppHeader scope="public" actions={actions} />}
        footerActions={footerActions}
      >
        {children}
      </ShellScaffold>
    </div>
  );
}
