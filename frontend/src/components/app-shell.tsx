import { Outlet } from "react-router-dom";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { AppHeaderStateProvider } from "@/components/app-header-state";
import { AppFrame } from "@/components/app-frame";
import { useAuth } from "@/lib/auth";

interface AppShellProps {
  mode: "company" | "admin";
}

export function AppShell({ mode }: AppShellProps) {
  const { companyIdentity } = useAuth();
  const menuTo =
    mode === "admin"
      ? "/admin/menu"
      : companyIdentity?.user.role === "admin"
        ? "/menu"
        : "/menu";

  return (
    <AppFrame>
      <AppHeaderStateProvider>
        <div className="flex flex-1 flex-col gap-4">
          <AppHeader menuTo={menuTo} scope={mode} />
          <main className="flex-1">
            <Outlet />
          </main>
          <AppFooter context="app" />
        </div>
      </AppHeaderStateProvider>
    </AppFrame>
  );
}
