import type { Transition, Variants } from "motion/react";

// One easing curve and a few durations used everywhere, so motion feels consistent.
export const EASE = [0.22, 1, 0.36, 1] as const;
export const FAST: Transition = { duration: 0.18, ease: EASE };
export const BASE: Transition = { duration: 0.32, ease: EASE };

/** Parent that reveals its `item` children one after another. */
export const stagger = (gap = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

export const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: BASE },
};

/**
 * Draws an SVG path from nothing to complete (adapted from Motion's "Path drawing"
 * example). `custom` is the item's position in the sequence: later items start later.
 */
export const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => {
    const delay = i * 0.5;
    return {
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { delay, type: "spring", duration: 1.5, bounce: 0 },
        opacity: { delay, duration: 0.01 },
      },
    };
  },
};
