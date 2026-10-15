import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";

import { Icon } from "./Icon";
import { BASE, FAST, stagger } from "./motionTokens";
import { useReducedMotionPref } from "../hooks/useReducedMotionPref";

// Trigger a little before the element is fully on screen, and only once.
const VIEWPORT = { once: true, amount: 0.2, margin: "0px 0px -60px 0px" } as const;

type Tag = "div" | "section" | "footer" | "aside";

/**
 * Fades and lifts its content in when it scrolls into view.
 * Use `lift={false}` on elements that already move on hover with CSS
 * (an inline transform would cancel their hover effect).
 */
export function Reveal({
  as = "div",
  className,
  delay = 0,
  lift = true,
  children,
  ...rest
}: {
  as?: Tag;
  className?: string;
  delay?: number;
  lift?: boolean;
  children: ReactNode;
  id?: string;
  "aria-label"?: string;
}) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      initial={{ opacity: 0, ...(lift ? { y: 28 } : {}) }}
      whileInView={{ opacity: 1, ...(lift ? { y: 0 } : {}), transition: { ...BASE, duration: 0.55, delay } }}
      viewport={VIEWPORT}
      {...rest}
    >
      {children}
    </Component>
  );
}

/** Reveals its <RevealItem> children one after another as it scrolls into view. */
export function RevealGroup({
  as = "div",
  className,
  gap = 0.08,
  children,
  ...rest
}: {
  as?: Tag;
  className?: string;
  gap?: number;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const Component = motion[as];
  return (
    <Component className={className} variants={stagger(gap)} initial="hidden" whileInView="show" viewport={VIEWPORT} {...rest}>
      {children}
    </Component>
  );
}

export function RevealItem({ className, lift = true, children }: { className?: string; lift?: boolean; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, ...(lift ? { y: 22 } : {}) },
        show: { opacity: 1, ...(lift ? { y: 0 } : {}), transition: { ...BASE, duration: 0.5 } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Thin bar at the top of the window showing how far down the page you are. */
export function ScrollProgress() {
  const reduced = useReducedMotionPref();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });

  return <motion.div className="scroll-progress" style={{ scaleX: reduced ? scrollYProgress : smooth }} aria-hidden="true" />;
}

/** Appears after scrolling down; returns to the top of the page. */
export function BackToTop() {
  const reduced = useReducedMotionPref();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 700);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          className="back-to-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })}
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: FAST }}
          exit={{ opacity: 0, y: 12, scale: 0.9, transition: FAST }}
        >
          <Icon name="arrow-left" size={18} className="back-to-top-icon" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
