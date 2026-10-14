import { MeshGradient, PulsingBorder } from "@paper-design/shaders-react";
import { motion } from "motion/react";

import { useReducedMotionPref } from "../hooks/useReducedMotionPref";

// Brand-leaning palette for the moving gradients and the pulsing ring.
const MESH_A = ["#000000", "#2f7bff", "#1f55d6", "#0b2a6b", "#22d3ee"];
const MESH_B = ["#000000", "#ffffff", "#6aa5ff", "#22d3ee"];
const RING = ["#2f7bff", "#1f55d6", "#22d3ee", "#6aa5ff", "#7fe9ff", "#38bdf8", "#ffffff"];

/**
 * Full-width shader hero (adapted from the "Shader showcase" component):
 * two layered animated mesh gradients, a glowing gradient headline, and a
 * pulsing ring with rotating text. The component's own top bar is left out,
 * since the site already has one.
 */
export default function ShaderShowcase({
  badge,
  title,
  emphasis,
  subtitle,
  description,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  ringText = "FRAMEHOUSE • WATCH • CONNECT • ",
}: {
  badge: string;
  /** First headline line, drawn in the animated gradient. */
  title: string;
  /** Bold second line. */
  emphasis: string;
  /** Light italic third line. */
  subtitle: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  ringText?: string;
}) {
  const reduced = useReducedMotionPref();

  return (
    <div className="shader-hero">
      <svg className="shader-defs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="shader-text-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      <MeshGradient className="shader-layer" colors={MESH_A} speed={reduced ? 0 : 0.3} />
      <MeshGradient className="shader-layer shader-layer-soft" colors={MESH_B} speed={reduced ? 0 : 0.2} />
      <div className="shader-scrim" />

      <motion.div
        className="shader-copy"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.18 } } }}
      >
        <motion.div className="shader-badge" variants={rise}>
          <span>{badge}</span>
        </motion.div>

        <motion.h2 className="shader-title" variants={rise}>
          <motion.span
            className="shader-title-gradient"
            animate={reduced ? undefined : { backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
            transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          >
            {title}
          </motion.span>
          <span className="shader-title-strong">{emphasis}</span>
          <span className="shader-title-light">{subtitle}</span>
        </motion.h2>

        <motion.p className="shader-description" variants={rise}>
          {description}
        </motion.p>

        <motion.div className="shader-actions" variants={rise}>
          <motion.button
            className="shader-btn outline"
            onClick={onSecondary}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            {secondaryLabel}
          </motion.button>
          <motion.button
            className="shader-btn solid"
            onClick={onPrimary}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            {primaryLabel}
          </motion.button>
        </motion.div>
      </motion.div>

      <div className="shader-ring" aria-hidden="true">
        <PulsingBorder
          colors={RING}
          colorBack="#00000000"
          speed={reduced ? 0 : 1.5}
          roundness={1}
          thickness={0.1}
          softness={0.2}
          intensity={5}
          spots={5}
          spotSize={0.1}
          pulse={0.1}
          smoke={0.5}
          smokeSize={4}
          scale={0.65}
          rotation={0}
          frame={9161408.251009725}
          style={{ width: "60px", height: "60px", borderRadius: "50%" }}
        />

        <motion.svg
          className="shader-ring-text"
          viewBox="0 0 100 100"
          animate={reduced ? undefined : { rotate: 360 }}
          transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        >
          <defs>
            <path id="shader-ring-path" d="M 50, 50 m -38, 0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0" />
          </defs>
          <text>
            <textPath href="#shader-ring-path" startOffset="0%" textLength="236" lengthAdjust="spacing">
              {ringText}
            </textPath>
          </text>
        </motion.svg>
      </div>
    </div>
  );
}

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};
