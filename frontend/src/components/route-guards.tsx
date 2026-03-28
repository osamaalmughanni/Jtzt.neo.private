import { Navigate, Outlet } from "react-router-dom";
import { AppRouteLoadingState } from "@/components/page-load-state";
import { useAuth } from "@/lib/auth";

export function CompanyGuard() {
  const { loading, companySession, companyIdentity, tabletAccess } = useAuth();
  if (loading || (companySession && !companyIdentity)) return <AppRouteLoadingState />;
  if (companySession) return <Outlet />;
  return tabletAccess ? <Navigate to="/tablet/pin" replace /> : <Navigate to="/login" replace />;
}

export function AdminGuard() {
  const { loading, adminSession } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  return adminSession ? <Outlet /> : <Navigate to="/?mode=admin" replace />;
}

export function CompanyAdminGuard() {
  const { loading, companySession, companyIdentity, isTabletMode, tabletAccess } = useAuth();
  if (loading || (companySession && !companyIdentity)) return <AppRouteLoadingState />;
  if (!companySession) return tabletAccess ? <Navigate to="/tablet/pin" replace /> : <Navigate to="/login" replace />;
  return !isTabletMode && companyIdentity?.user.role === "admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

export function CompanyFullAccessGuard() {
  const { loading, companySession, companyIdentity, isTabletMode, tabletAccess } = useAuth();
  if (loading || (companySession && !companyIdentity)) return <AppRouteLoadingState />;
  if (!companySession) return tabletAccess ? <Navigate to="/tablet/pin" replace /> : <Navigate to="/login" replace />;
  return !isTabletMode ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
