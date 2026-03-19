import { Navigate } from "react-router-dom";

export function AdminLoginPage() {
  return <Navigate to="/?mode=admin" replace />;
}
