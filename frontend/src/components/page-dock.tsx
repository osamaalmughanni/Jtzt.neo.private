import { useEffect, useRef } from "react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageDock({ children, cacheKey }: { children: React.ReactNode; cacheKey?: string }) {
  const { setBottomBar, setBottomBarKey } = useAppHeaderState();
  const childrenRef = useRef(children);

  useEffect(() => {
    childrenRef.current = children;
  }, [children]);

  useEffect(() => {
    setBottomBar(childrenRef.current);
    setBottomBarKey(cacheKey ?? null);
    return () => {
      setBottomBar(null);
      setBottomBarKey(null);
    };
  }, [cacheKey, setBottomBar, setBottomBarKey]);

  return null;
}
