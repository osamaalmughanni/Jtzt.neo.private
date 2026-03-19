import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppHeaderState } from "@/components/app-header-state";

const INITIAL_PROGRESS = 14;
const ACTIVE_PROGRESS_CAP = 86;
const ACTIVE_SMOOTHING_MS = 950;
const FINISH_SMOOTHING_MS = 190;
const COMPLETE_HIDE_DELAY_MS = 210;

export function AppHeaderLoadingBar() {
  const { loadingCount } = useAppHeaderState();
  const active = loadingCount > 0;
  const [visible, setVisible] = useState(active);
  const [progress, setProgress] = useState(active ? INITIAL_PROGRESS : 0);
  const animationFrameRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const activeRef = useRef(active);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }

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
      setVisible(true);
      setProgress((current) => (current > 0 ? current : INITIAL_PROGRESS));
      return;
    }

    if (!visible) {
      return;
    }

    setProgress(100);
    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
      hideTimeoutRef.current = null;
    }, 220);
  }, [active, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    let lastTime: number | null = null;

    const tick = (now: number) => {
      if (cancelled) {
        return;
      }

      if (lastTime === null) {
        lastTime = now;
      }

      const delta = now - lastTime;
      lastTime = now;
      const current = progressRef.current;
      const target = activeRef.current ? ACTIVE_PROGRESS_CAP : 100;
      const smoothing = activeRef.current ? ACTIVE_SMOOTHING_MS : FINISH_SMOOTHING_MS;
      const factor = 1 - Math.exp(-delta / smoothing);
      const next = target - (target - current) * (1 - factor);
      const resolved = target - next < 0.08 ? target : next;

      if (resolved !== current) {
        progressRef.current = resolved;
        setProgress(resolved);
      }

      if (!activeRef.current && resolved >= 100) {
        if (hideTimeoutRef.current !== null) {
          window.clearTimeout(hideTimeoutRef.current);
        }

        hideTimeoutRef.current = window.setTimeout(() => {
          if (!activeRef.current) {
            setVisible(false);
            setProgress(0);
            progressRef.current = 0;
          }

          hideTimeoutRef.current = null;
        }, COMPLETE_HIDE_DELAY_MS);

        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [visible]);

  return (
    <div className="relative h-0.5 w-full overflow-hidden rounded-[999px] bg-border/40">
      <AnimatePresence initial={false}>
        {visible && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-[999px] bg-primary"
            style={{ boxShadow: "0 0 14px hsl(var(--primary) / 0.18)" }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: `${progress}%`, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
            transition={{
              width: { duration: 0.08, ease: "linear" },
              opacity: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
