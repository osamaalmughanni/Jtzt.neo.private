const COMPANY_SESSION_KEY = "jtzt.company.session";
const ADMIN_SESSION_KEY = "jtzt.admin.session";

export interface StoredSession {
  token: string;
  actorType: "admin" | "company_user";
  expiresAt: string;
}

function readSession(key: string): StoredSession | null {
  const value = localStorage.getItem(key);
  if (!value) {
    return null;
  }

  try {
    const session = JSON.parse(value) as StoredSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }

    return session;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export const sessionStorage = {
  getCompanySession() {
    return readSession(COMPANY_SESSION_KEY);
  },
  setCompanySession(session: StoredSession) {
    localStorage.setItem(COMPANY_SESSION_KEY, JSON.stringify(session));
  },
  clearCompanySession() {
    localStorage.removeItem(COMPANY_SESSION_KEY);
  },
  getAdminSession() {
    return readSession(ADMIN_SESSION_KEY);
  },
  setAdminSession(session: StoredSession) {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  },
  clearAdminSession() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }
};
