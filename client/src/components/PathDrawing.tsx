import { motion } from "motion/react";

import { draw } from "./motionTokens";
import { useReducedMotionPref } from "../hooks/useReducedMotionPref";

const shape = {
  strokeWidth: 4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "transparent",
};

/**
 * An animated circle with a tick (success) or a cross (failure), drawn stroke by stroke.
 * Takes its colour from the surrounding text colour. With reduced motion it appears fully drawn.
 */
export function DrawnMark({ kind, size = 72, label }: { kind: "success" | "failed"; size?: number; label?: string }) {
  const reduced = useReducedMotionPref();

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      initial={reduced ? "visible" : "hidden"}
      animate="visible"
      role="img"
      aria-label={label || (kind === "success" ? "Success" : "Failed")}
      stroke="currentColor"
    >
      <motion.circle cx="32" cy="32" r="26" variants={draw} custom={0} style={shape} />
      {kind === "success" ? (
        <motion.path d="M20.5 33.5 L28.5 41.5 L44 24" variants={draw} custom={1.2} style={shape} />
      ) : (
        <>
          <motion.line x1="23" y1="23" x2="41" y2="41" variants={draw} custom={1.2} style={shape} />
          <motion.line x1="41" y1="23" x2="23" y2="41" variants={draw} custom={1.6} style={shape} />
        </>
      )}
    </motion.svg>
  );
}
