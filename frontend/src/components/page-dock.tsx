import { useEffect } from "react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageDock({ children }: { children: React.ReactNode }) {
  const { setBottomBar } = useAppHeaderState();

  useEffect(() => {
    setBottomBar(children);
    return () => setBottomBar(null);
  }, [children, setBottomBar]);

  return null;
}
