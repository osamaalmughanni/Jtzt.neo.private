import { createContext, useContext, useMemo, useState } from "react";
import type { HeaderAction } from "@/components/app-header";

interface AppHeaderStateValue {
  actions: HeaderAction[] | null;
  setActions: (actions: HeaderAction[] | null) => void;
}

const AppHeaderStateContext = createContext<AppHeaderStateValue | null>(null);

export function AppHeaderStateProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<HeaderAction[] | null>(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return <AppHeaderStateContext.Provider value={value}>{children}</AppHeaderStateContext.Provider>;
}

export function useAppHeaderState() {
  const context = useContext(AppHeaderStateContext);
  if (!context) {
    throw new Error("useAppHeaderState must be used inside AppHeaderStateProvider");
  }

  return context;
}
