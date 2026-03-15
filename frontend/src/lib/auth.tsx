import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CompanyMeResponse } from "@shared/types/api";
import { api } from "./api";
import { sessionStorage, type StoredSession, type StoredTabletAccess } from "./storage";

interface AuthContextValue {
  companySession: StoredSession | null;
  adminSession: StoredSession | null;
  companyIdentity: CompanyMeResponse | null;
  adminIdentity: { username: string } | null;
  tabletAccess: StoredTabletAccess | null;
  isTabletMode: boolean;
  loading: boolean;
  loginCompany: (session: StoredSession) => Promise<void>;
  loginAdmin: (session: StoredSession) => Promise<void>;
  setTabletAccess: (access: StoredTabletAccess) => void;
  clearTabletAccess: () => void;
  lockTablet: () => void;
  logoutCompany: () => void;
  logoutAdmin: () => void;
  refreshCompany: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [companySession, setCompanySession] = useState<StoredSession | null>(() => sessionStorage.getCompanySession());
  const [adminSession, setAdminSession] = useState<StoredSession | null>(() => sessionStorage.getAdminSession());
  const [tabletAccess, setTabletAccessState] = useState<StoredTabletAccess | null>(() => sessionStorage.getTabletAccess());
  const [companyIdentity, setCompanyIdentity] = useState<CompanyMeResponse | null>(null);
  const [adminIdentity, setAdminIdentity] = useState<{ username: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function bootstrap() {
    if (companySession) {
      try {
        setCompanyIdentity(await api.getCompanyMe(companySession.token));
      } catch {
        sessionStorage.clearCompanySession();
        setCompanySession(null);
        setCompanyIdentity(null);
      }
    }

    if (adminSession) {
      try {
        setAdminIdentity(await api.getAdminMe(adminSession.token));
      } catch {
        sessionStorage.clearAdminSession();
        setAdminSession(null);
        setAdminIdentity(null);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      companySession,
      adminSession,
      companyIdentity,
      adminIdentity,
      tabletAccess,
      isTabletMode: companySession?.accessMode === "tablet",
      loading,
      async loginCompany(session) {
        sessionStorage.setCompanySession(session);
        setCompanySession(session);
        setCompanyIdentity(await api.getCompanyMe(session.token));
      },
      async loginAdmin(session) {
        sessionStorage.setAdminSession(session);
        setAdminSession(session);
        setAdminIdentity(await api.getAdminMe(session.token));
      },
      setTabletAccess(access) {
        sessionStorage.setTabletAccess(access);
        setTabletAccessState(access);
      },
      clearTabletAccess() {
        sessionStorage.clearTabletAccess();
        setTabletAccessState(null);
      },
      lockTablet() {
        sessionStorage.clearCompanySession();
        setCompanySession(null);
        setCompanyIdentity(null);
      },
      logoutCompany() {
        sessionStorage.clearCompanySession();
        setCompanySession(null);
        setCompanyIdentity(null);
      },
      logoutAdmin() {
        sessionStorage.clearAdminSession();
        setAdminSession(null);
        setAdminIdentity(null);
      },
      async refreshCompany() {
        if (!companySession) return;
        setCompanyIdentity(await api.getCompanyMe(companySession.token));
      }
    }),
    [adminIdentity, adminSession, companyIdentity, companySession, loading, tabletAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
