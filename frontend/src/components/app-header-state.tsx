import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { HeaderAction } from "@/components/app-header";

export interface HeaderHomeAction {
  key?: string;
  label: string;
  onClick: () => void;
}

interface AppHeaderStateValue {
  actions: HeaderAction[] | null;
  setActions: (actions: HeaderAction[] | null) => void;
  homeAction: HeaderHomeAction | null;
  setHomeAction: (action: HeaderHomeAction | null) => void;
  bottomBar: ReactNode | null;
  bottomBarKey: string | null;
  setBottomBar: (bottomBar: ReactNode | null, bottomBarKey?: string | null) => void;
  loadingCount: number;
  startLoading: () => void;
  stopLoading: () => void;
}

const AppHeaderStateContext = createContext<AppHeaderStateValue | null>(null);

export function AppHeaderStateProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<HeaderAction[] | null>(null);
  const [homeAction, setHomeAction] = useState<HeaderHomeAction | null>(null);
  const [bottomBar, setBottomBar] = useState<ReactNode | null>(null);
  const [bottomBarKey, setBottomBarKey] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const applyBottomBar = useCallback((nextBottomBar: ReactNode | null, nextBottomBarKey?: string | null) => {
    setBottomBar(nextBottomBar);
    setBottomBarKey(nextBottomBar ? (nextBottomBarKey ?? null) : null);
  }, []);
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
      homeAction,
      setHomeAction,
      bottomBar,
      bottomBarKey,
      setBottomBar: applyBottomBar,
      loadingCount,
      startLoading,
      stopLoading,
    }),
    [actions, applyBottomBar, bottomBar, bottomBarKey, homeAction, loadingCount, startLoading, stopLoading]
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
