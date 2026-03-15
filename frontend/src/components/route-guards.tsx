import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function CompanyGuard() {
  const { loading, companySession } = useAuth();
  if (loading) return null;
  return companySession ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AdminGuard() {
  const { loading, adminSession } = useAuth();
  if (loading) return null;
  return adminSession ? <Outlet /> : <Navigate to="/admin/login" replace />;
}

export function CompanyAdminGuard() {
  const { loading, companySession, companyIdentity } = useAuth();
  if (loading) return null;
  if (!companySession) return <Navigate to="/login" replace />;
  return companyIdentity?.user.role === "company_admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
