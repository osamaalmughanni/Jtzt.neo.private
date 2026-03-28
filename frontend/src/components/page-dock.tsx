import { AnimatePresence, motion } from "framer-motion";

export function PageDock({ children, cacheKey }: { children: React.ReactNode; cacheKey?: string }) {
  return (
    <div className="min-h-[8.5rem]">
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={cacheKey ?? "page-dock"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          style={{ willChange: "opacity" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
