import { useEffect, useRef } from "react";
import { useAppHeaderState } from "@/components/app-header-state";

export function PageDock({ children, cacheKey }: { children: React.ReactNode; cacheKey?: string }) {
  const { setBottomBar } = useAppHeaderState();
  const childrenRef = useRef(children);

  useEffect(() => {
    childrenRef.current = children;
  }, [children]);

  useEffect(() => {
    setBottomBar(childrenRef.current);
    return () => {
      setBottomBar(null);
    };
  }, [cacheKey, setBottomBar]);

  return null;
}
