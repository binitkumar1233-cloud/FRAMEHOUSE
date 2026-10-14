import type { ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { BASE, FAST } from "./motionTokens";
import { useReducedMotionPref } from "../hooks/useReducedMotionPref";

export function AppMotion({ children }: { children: ReactNode }) {
  // Follows the app's Reduce motion setting and the OS setting.
  const reduced = useReducedMotionPref();
  return <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>;
}

/** Cross-fades between pages. `id` changes when the page changes. */
export function PageTransition({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: BASE }}
        exit={{ opacity: 0, y: -6, transition: FAST }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Backdrop + panel for dialogs: fades the backdrop, lifts the panel in. */
export function DialogMotion({
  onBackdrop,
  className,
  children,
  labelledBy,
  role = "dialog",
}: {
  onBackdrop?: () => void;
  className: string;
  children: ReactNode;
  labelledBy?: string;
  role?: "dialog" | "alertdialog";
}) {
  return (
    <motion.div
      className="modal-backdrop"
      onMouseDown={onBackdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FAST }}
      exit={{ opacity: 0, transition: FAST }}
    >
      <motion.div
        className={className}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: BASE }}
        exit={{ opacity: 0, y: 10, scale: 0.98, transition: FAST }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
