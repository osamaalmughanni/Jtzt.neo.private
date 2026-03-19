import { Navigate, useLocation } from "react-router-dom";

export function LoginPage() {
  const location = useLocation();
  return <Navigate to={`/${location.search}`} replace />;
}
