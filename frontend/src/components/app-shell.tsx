import { Outlet } from "react-router-dom";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
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
      : companyIdentity?.user.role === "company_admin"
        ? "/menu"
        : "/menu";

  return (
    <AppFrame>
      <AppHeader menuTo={menuTo} scope={mode} />
      <main className="flex-1">
        <Outlet />
      </main>
      <AppFooter context="app" />
    </AppFrame>
  );
}
