import { motion } from "motion/react";
import type { Variants } from "motion/react";

import { Icon } from "./Icon";

type IconName = Parameters<typeof Icon>[0]["name"];

export type ScrollCard = {
  icon: IconName;
  /** Small label above the title, e.g. "Streaming". */
  kicker: string;
  title: string;
  text: string;
  cta?: string;
  /** Two hues (0-360) for the gradient splash behind the card. */
  hueA: number;
  hueB: number;
  onClick?: () => void;
};

// Cards start below their slot and spring up with a slight tilt as they scroll into view.
const cardVariants: Variants = {
  offscreen: {
    y: 240,
    rotate: 0,
  },
  onscreen: {
    y: 36,
    rotate: -4,
    transition: {
      type: "spring",
      bounce: 0.28,
      duration: 0.9,
    },
  },
};

// Muted, brand-leaning colours for the splash.
const hue = (h: number) => `hsl(${h}, 70%, 58%)`;

/**
 * Scroll-triggered feature cards (adapted from Motion's "Scroll-triggered" example).
 * Each card springs into place when most of it is on screen.
 */
export function ScrollTriggeredCards({ items }: { items: ScrollCard[] }) {
  return (
    <div className="scroll-cards">
      {items.map((item, i) => (
        <Card key={item.title} item={item} i={i} />
      ))}
    </div>
  );
}

function Card({ item, i }: { item: ScrollCard; i: number }) {
  const background = `linear-gradient(306deg, ${hue(item.hueA)}, ${hue(item.hueB)})`;
  const Inner = item.onClick ? motion.button : motion.div;

  return (
    <motion.div
      className={`scroll-card-container card-container-${i}`}
      initial="offscreen"
      whileInView="onscreen"
      viewport={{ amount: 0.7 }}
    >
      <div className="scroll-card-splash" style={{ background }} />
      <Inner
        className="scroll-card"
        variants={cardVariants}
        {...(item.onClick ? { type: "button" as const, onClick: item.onClick } : {})}
      >
        <span className="scroll-card-index" aria-hidden="true">
          {String(i + 1).padStart(2, "0")}
        </span>
        <span className="scroll-card-icon" style={{ background }} aria-hidden="true">
          <Icon name={item.icon} size={26} />
        </span>
        <span className="scroll-card-kicker">{item.kicker}</span>
        <strong className="scroll-card-title">{item.title}</strong>
        <span className="scroll-card-text">{item.text}</span>
        {item.onClick && (
          <span className="scroll-card-cta">
            {item.cta || "Explore"}
            <Icon name="arrow-right" size={15} />
          </span>
        )}
      </Inner>
    </motion.div>
  );
}
