import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageDock({ children, cacheKey }: { children: ReactNode; cacheKey?: string }) {
  const { setBottomBar } = useAppHeaderState();
  const childrenRef = useRef(children);

  useLayoutEffect(() => {
    childrenRef.current = children;
  }, [children]);

  useLayoutEffect(() => {
    setBottomBar(childrenRef.current, cacheKey ?? null);
    return () => {
      setBottomBar(null);
    };
  }, [cacheKey, setBottomBar]);

  return null;
}
