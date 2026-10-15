import { useRef } from "react";
import { useScroll, useTransform } from "motion/react";

import { useReducedMotionPref } from "./useReducedMotionPref";

/**
 * Moves an element by up to `distance` px while its section scrolls past,
 * so it drifts slightly slower than the page. Off when motion is reduced.
 */
export function useParallax<T extends HTMLElement>(distance = 60) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotionPref();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : distance]);
  return { ref, y };
}
