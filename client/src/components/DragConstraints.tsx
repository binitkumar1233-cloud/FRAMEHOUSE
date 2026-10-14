import { useRef } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";

/**
 * A draggable item kept inside its area (adapted from Motion's "Drag constraints"
 * example). The edges are slightly elastic, so the item eases back when pulled out.
 */
export function DragConstraints({
  className = "drag-area",
  itemClassName = "drag-item",
  label = "Draggable",
  children,
}: {
  className?: string;
  itemClassName?: string;
  label?: string;
  children?: ReactNode;
}) {
  const constraintsRef = useRef<HTMLDivElement>(null);

  return (
    <motion.div ref={constraintsRef} className={className}>
      <motion.div
        className={itemClassName}
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.2}
        whileHover={{ scale: 1.04 }}
        whileTap={{ cursor: "grabbing" }}
        whileDrag={{ scale: 1.08 }}
        aria-label={label}
        title={label}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
