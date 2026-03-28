import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { useAppHeaderState } from "@/components/app-header-state";

const COMPLETE_HIDE_DELAY_MS = 140;

export function AppHeaderLoadingBar() {
  const { loadingCount } = useAppHeaderState();
  const active = loadingCount > 0;
  const [visible, setVisible] = useState(active);
  const hideTimeoutRef = useRef<number | null>(null);
  const wasActiveRef = useRef(active);
  const fillTarget = useMotionValue(active ? 1 : 0);
  const fillSpring = useSpring(fillTarget, {
    stiffness: 240,
    damping: 32,
    mass: 0.65,
    restDelta: 0.0001,
    restSpeed: 0.0001,
  });

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (active) {
      if (!visible) {
        setVisible(true);
        fillTarget.set(0);
        window.requestAnimationFrame(() => {
          fillTarget.set(1);
        });
      } else {
        fillTarget.set(1);
      }

      wasActiveRef.current = true;
      return;
    }

    if (!wasActiveRef.current) {
      return;
    }

    wasActiveRef.current = false;
    fillTarget.set(1);
    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      fillTarget.set(0);
      hideTimeoutRef.current = null;
    }, COMPLETE_HIDE_DELAY_MS);
  }, [active, fillTarget, visible]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-px overflow-hidden bg-transparent">
      <AnimatePresence initial={false}>
        {visible && (
          <motion.div
            className="absolute inset-y-0 left-0 origin-left bg-primary"
            style={{
              width: "100%",
              scaleX: fillSpring,
              boxShadow: "0 0 12px hsl(var(--primary) / 0.22)",
              willChange: "transform, opacity",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }}
            transition={{
              opacity: { duration: 0.12, ease: [0.22, 1, 0.36, 1] },
            }}
          >
            <motion.div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-[35%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.42),transparent)]"
              style={{ opacity: active ? 0.34 : 0 }}
              animate={active ? { x: ["-45%", "145%"] } : { x: "-45%" }}
              transition={
                active
                  ? { duration: 0.85, ease: "linear", repeat: Infinity }
                  : { duration: 0.2, ease: "easeOut" }
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
