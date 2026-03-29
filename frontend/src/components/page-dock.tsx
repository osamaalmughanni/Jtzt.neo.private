import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageDock({ children, cacheKey }: { children: ReactNode; cacheKey?: string }) {
  const { setBottomBar } = useAppHeaderState();
  const childrenRef = useRef(children);

  useEffect(() => {
    childrenRef.current = children;
  }, [children]);

  useEffect(() => {
    setBottomBar(childrenRef.current, cacheKey ?? null);
    return () => {
      setBottomBar(null);
    };
  }, [cacheKey, setBottomBar]);

  return null;
}
