import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CompanySettings } from "@shared/types/models";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function createDefaultCompanySettings(): CompanySettings {
  return {
    currency: "EUR",
    locale: DEFAULT_COMPANY_LOCALE,
    timeZone: DEFAULT_COMPANY_TIME_ZONE,
    dateTimeFormat: DEFAULT_COMPANY_DATE_TIME_FORMAT,
    firstDayOfWeek: 1,
    weekendDays: [...DEFAULT_COMPANY_WEEKEND_DAYS],
    editDaysLimit: 30,
    insertDaysLimit: 30,
    allowOneRecordPerDay: false,
    allowIntersectingRecords: false,
    allowRecordsOnHolidays: true,
    allowRecordsOnWeekends: true,
    allowFutureRecords: false,
    country: "AT",
    tabletIdleTimeoutSeconds: 10,
    autoBreakAfterMinutes: 300,
    autoBreakDurationMinutes: 30,
    projectsEnabled: false,
    tasksEnabled: false,
    customFields: [],
    overtime: createDefaultOvertimeSettings(),
  };
}

interface CompanySettingsContextValue {
  settings: CompanySettings | null;
  loading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: CompanySettings) => void;
}

const CompanySettingsContext = createContext<CompanySettingsContextValue | null>(null);

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const { companySession } = useAuth();
  const [settings, setSettingsState] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.getSettings(token);
      setSettingsState(response.settings);
    } catch (error) {
      setSettingsState(createDefaultCompanySettings());
      setError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!companySession) {
      setSettingsState(null);
      setLoading(false);
      setError(null);
      return;
    }

    void loadSettings(companySession.token);
  }, [companySession, loadSettings]);

  const value = useMemo<CompanySettingsContextValue>(
    () => ({
      settings,
      loading,
      error,
      async refreshSettings() {
        if (!companySession) {
          return;
        }

        await loadSettings(companySession.token);
      },
      setSettings(nextSettings) {
        setSettingsState(nextSettings);
      },
    }),
    [companySession, error, loadSettings, loading, settings],
  );

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}

export function useCompanySettings() {
  const context = useContext(CompanySettingsContext);
  if (!context) {
    throw new Error("useCompanySettings must be used inside CompanySettingsProvider");
  }

  return context;
}
