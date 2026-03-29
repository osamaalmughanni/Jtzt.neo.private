import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CompanyMeResponse } from "@shared/types/api";
import { ApiRequestError, api } from "./api";
import {
  ADMIN_SESSION_KEY,
  COMPANY_SESSION_KEY,
  TABLET_ACCESS_KEY,
  sessionStorage,
  type StoredSession,
  type StoredTabletAccess,
} from "./storage";
import { AUTH_INVALID_EVENT, type AuthInvalidEventDetail } from "./auth-events";

interface AuthContextValue {
  companySession: StoredSession | null;
  adminSession: StoredSession | null;
  companyIdentity: CompanyMeResponse | null;
  adminIdentity: { username: string } | null;
  tabletAccess: StoredTabletAccess | null;
  isTabletMode: boolean;
  loading: boolean;
  loginCompany: (session: StoredSession, options?: { persist?: boolean }) => Promise<void>;
  loginAdmin: (session: StoredSession) => Promise<void>;
  setTabletAccess: (access: StoredTabletAccess) => void;
  clearTabletAccess: () => void;
  lockTablet: () => void;
  logoutCompany: () => void;
  logoutAdmin: () => void;
  refreshCompany: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isAuthInvalidError(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [companySession, setCompanySession] = useState<StoredSession | null>(() => sessionStorage.getCompanySession());
  const [adminSession, setAdminSession] = useState<StoredSession | null>(() => sessionStorage.getAdminSession());
  const [tabletAccess, setTabletAccessState] = useState<StoredTabletAccess | null>(() => sessionStorage.getTabletAccess());
  const [companyIdentity, setCompanyIdentity] = useState<CompanyMeResponse | null>(null);
  const [adminIdentity, setAdminIdentity] = useState<{ username: string } | null>(null);
  const [loading, setLoading] = useState(true);

  function clearCompanySession() {
    sessionStorage.clearCompanySession();
    setCompanySession(null);
    setCompanyIdentity(null);
  }

  function clearAdminSession() {
    sessionStorage.clearAdminSession();
    setAdminSession(null);
    setAdminIdentity(null);
  }

  async function validateActiveSessions() {
    if (companySession) {
      try {
        setCompanyIdentity(await api.getCompanyMe(companySession.token));
      } catch (error) {
        if (isAuthInvalidError(error)) {
          clearCompanySession();
        }
      }
    }

    if (adminSession) {
      try {
        setAdminIdentity(await api.getAdminMe(adminSession.token));
      } catch (error) {
        if (isAuthInvalidError(error)) {
          clearAdminSession();
        }
      }
    }
  }

  async function bootstrap() {
    await validateActiveSessions();
    setLoading(false);
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const syncFromStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return;
      }

      if (event.key === COMPANY_SESSION_KEY) {
        setCompanySession(sessionStorage.getCompanySession());
        setCompanyIdentity(null);
      }

      if (event.key === ADMIN_SESSION_KEY) {
        setAdminSession(sessionStorage.getAdminSession());
        setAdminIdentity(null);
      }

      if (event.key === TABLET_ACCESS_KEY) {
        setTabletAccessState(sessionStorage.getTabletAccess());
      }
    };

    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  useEffect(() => {
    if (loading || (!companySession && !adminSession)) {
      return;
    }

    let cancelled = false;

    const runValidation = async () => {
      if (cancelled) {
        return;
      }

      await validateActiveSessions();
    };

    const onFocus = () => {
      void runValidation();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runValidation();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [adminSession, companySession, loading]);

  useEffect(() => {
    const handleAuthInvalid = (event: Event) => {
      const { token } = (event as CustomEvent<AuthInvalidEventDetail>).detail;

      if (companySession?.token === token) {
        clearCompanySession();
      }

      if (adminSession?.token === token) {
        clearAdminSession();
      }
    };

    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
    return () => {
      window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
    };
  }, [adminSession?.token, companySession?.token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      companySession,
      adminSession,
      companyIdentity,
      adminIdentity,
      tabletAccess,
      isTabletMode: companySession?.accessMode === "tablet",
      loading,
      async loginCompany(session, options) {
        if (options?.persist !== false) {
          sessionStorage.setCompanySession(session);
        }
        setCompanySession(session);
        try {
          setCompanyIdentity(await api.getCompanyMe(session.token));
        } catch (error) {
          if (isAuthInvalidError(error)) {
            clearCompanySession();
            throw error;
          }
        }
      },
      async loginAdmin(session) {
        sessionStorage.setAdminSession(session);
        setAdminSession(session);
        try {
          setAdminIdentity(await api.getAdminMe(session.token));
        } catch (error) {
          if (isAuthInvalidError(error)) {
            clearAdminSession();
            throw error;
          }
        }
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
        clearCompanySession();
      },
      logoutCompany() {
        clearCompanySession();
      },
      logoutAdmin() {
        clearAdminSession();
      },
      async refreshCompany() {
        if (!companySession) return;
        try {
          setCompanyIdentity(await api.getCompanyMe(companySession.token));
        } catch (error) {
          if (isAuthInvalidError(error)) {
            clearCompanySession();
            throw error;
          }
        }
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
