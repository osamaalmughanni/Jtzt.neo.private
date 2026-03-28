import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface RouteRevealProps {
  routeKey: string;
  className?: string;
  children: ReactNode;
}

export function RouteReveal({ routeKey, className, children }: RouteRevealProps) {
  const [visible, setVisible] = useState(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setVisible(false);
  }, [routeKey]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) {
      return;
    }

    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const revealAfterQuiet = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (!cancelled) {
          setVisible(true);
        }
      }, 120);
    };

    const startReveal = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = window.requestAnimationFrame(() => {
          revealAfterQuiet();
        });
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      revealAfterQuiet();
    });
    resizeObserver.observe(node);

    const mutationObserver = new MutationObserver(() => {
      revealAfterQuiet();
    });
    mutationObserver.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    startReveal();

    return () => {
      cancelled = true;
      clearTimer();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [routeKey]);

  return (
    <motion.div
      ref={nodeRef}
      className={cn(className)}
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{ willChange: "opacity" }}
    >
      {children}
    </motion.div>
  );
}
