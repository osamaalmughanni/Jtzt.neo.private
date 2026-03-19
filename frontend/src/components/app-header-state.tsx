import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { HeaderAction } from "@/components/app-header";

interface AppHeaderStateValue {
  actions: HeaderAction[] | null;
  setActions: (actions: HeaderAction[] | null) => void;
  loadingCount: number;
  startLoading: () => void;
  stopLoading: () => void;
}

const AppHeaderStateContext = createContext<AppHeaderStateValue | null>(null);

export function AppHeaderStateProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<HeaderAction[] | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const startLoading = useCallback(() => {
    setLoadingCount((current) => current + 1);
  }, []);
  const stopLoading = useCallback(() => {
    setLoadingCount((current) => Math.max(0, current - 1));
  }, []);
  const value = useMemo(
    () => ({
      actions,
      setActions,
      loadingCount,
      startLoading,
      stopLoading,
    }),
    [actions, loadingCount, startLoading, stopLoading]
  );
  return <AppHeaderStateContext.Provider value={value}>{children}</AppHeaderStateContext.Provider>;
}

export function useAppHeaderState() {
  const context = useContext(AppHeaderStateContext);
  if (!context) {
    throw new Error("useAppHeaderState must be used inside AppHeaderStateProvider");
  }

  return context;
}
