import { Navigate, Outlet } from "react-router-dom";
import { AppRouteLoadingState } from "@/components/page-load-state";
import { useAuth } from "@/lib/auth";

export function CompanyGuard() {
  const { loading, companySession } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  return companySession ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AdminGuard() {
  const { loading, adminSession } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  return adminSession ? <Outlet /> : <Navigate to="/?mode=admin" replace />;
}

export function CompanyAdminGuard() {
  const { loading, companySession, companyIdentity } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  if (!companySession) return <Navigate to="/login" replace />;
  return companySession.accessMode !== "tablet" && companyIdentity?.user.role === "admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

export function CompanyFullAccessGuard() {
  const { loading, companySession } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  if (!companySession) return <Navigate to="/login" replace />;
  return companySession.accessMode !== "tablet" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
