export const COMPANY_SESSION_KEY = "jtzt.company.session";
export const ADMIN_SESSION_KEY = "jtzt.admin.session";
export const TABLET_ACCESS_KEY = "jtzt.tablet.access";
export const LANGUAGE_KEY = "jtzt.language";
export const THEME_KEY = "jtzt.theme";

declare global {
  interface Window {
    JtztNativeStorage?: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };
  }
}

export interface StoredSession {
  token: string;
  actorType: "admin" | "company_user" | "workspace";
  accessMode?: "full" | "tablet";
  expiresAt: string;
}

export interface StoredTabletAccess {
  companyName: string;
  code: string;
}

const NATIVE_MIRROR_KEYS = new Set([
  COMPANY_SESSION_KEY,
  ADMIN_SESSION_KEY,
  TABLET_ACCESS_KEY,
  LANGUAGE_KEY,
  THEME_KEY
]);

function getNativeStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.JtztNativeStorage ?? null;
}

function readStorageValue(key: string) {
  const localValue = localStorage.getItem(key);
  if (localValue !== null) {
    return localValue;
  }

  if (!NATIVE_MIRROR_KEYS.has(key)) {
    return null;
  }

  const nativeValue = getNativeStorage()?.getItem(key) ?? null;
  if (nativeValue !== null) {
    localStorage.setItem(key, nativeValue);
  }

  return nativeValue;
}

function writeStorageValue(key: string, value: string) {
  localStorage.setItem(key, value);
  if (NATIVE_MIRROR_KEYS.has(key)) {
    getNativeStorage()?.setItem(key, value);
  }
}

function clearStorageValue(key: string) {
  localStorage.removeItem(key);
  if (NATIVE_MIRROR_KEYS.has(key)) {
    getNativeStorage()?.removeItem(key);
  }
}

function readSession(key: string): StoredSession | null {
  const value = readStorageValue(key);
  if (!value) {
    return null;
  }

  try {
    const session = JSON.parse(value) as StoredSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      clearStorageValue(key);
      return null;
    }

    return session;
  } catch {
    clearStorageValue(key);
    return null;
  }
}

export const sessionStorage = {
  getCompanySession() {
    return readSession(COMPANY_SESSION_KEY);
  },
  setCompanySession(session: StoredSession) {
    writeStorageValue(COMPANY_SESSION_KEY, JSON.stringify(session));
  },
  clearCompanySession() {
    clearStorageValue(COMPANY_SESSION_KEY);
  },
  getAdminSession() {
    return readSession(ADMIN_SESSION_KEY);
  },
  setAdminSession(session: StoredSession) {
    writeStorageValue(ADMIN_SESSION_KEY, JSON.stringify(session));
  },
  clearAdminSession() {
    clearStorageValue(ADMIN_SESSION_KEY);
  },
  getTabletAccess() {
    const value = readStorageValue(TABLET_ACCESS_KEY);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as StoredTabletAccess;
    } catch {
      clearStorageValue(TABLET_ACCESS_KEY);
      return null;
    }
  },
  setTabletAccess(access: StoredTabletAccess) {
    writeStorageValue(TABLET_ACCESS_KEY, JSON.stringify(access));
  },
  clearTabletAccess() {
    clearStorageValue(TABLET_ACCESS_KEY);
  }
};

export const appStorage = {
  getLanguage() {
    const value = readStorageValue(LANGUAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  },
  setLanguage(language: string) {
    writeStorageValue(LANGUAGE_KEY, language);
  },
  clearLanguage() {
    clearStorageValue(LANGUAGE_KEY);
  },
  getTheme() {
    const value = readStorageValue(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  },
  setTheme(theme: "light" | "dark") {
    writeStorageValue(THEME_KEY, theme);
  },
  clearTheme() {
    clearStorageValue(THEME_KEY);
  },
};
