import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import type { CSSProperties } from "react";

import { Icon } from "./Icon";
import { useReducedMotionPref } from "../hooks/useReducedMotionPref";

export type GalleryItem = {
  id: string;
  image: string;
  label: string;
  kicker?: string;
  tag?: string;
  onClick?: () => void;
};

// Muted brand-leaning tints for the bottom fade of each card.
const TINTS = ["#1f55d6", "#3f5fe0", "#7a3fe0", "#3f86e0", "#6a3fe0", "#4a3fe0"];

// Height of the sticky site header the gallery pins beneath.
const HEADER = 74;

/**
 * Horizontal scroll gallery (adapted from Motion's "Scroll horizontal" example).
 * The section pins to the screen while vertical scrolling slides the cards sideways.
 * With reduced motion it becomes an ordinary sideways-scrolling row.
 */
export function HorizontalScrollGallery({
  eyebrow,
  title,
  action,
  onAction,
  items,
  fallbackImage,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
  items: GalleryItem[];
  fallbackImage: string;
}) {
  const reduced = useReducedMotionPref();
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);

  // Scrolling range = how far the row overflows the screen. Measured, not hard-coded,
  // so it stays right at every screen size.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setDistance(Math.max(0, track.scrollWidth - track.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    Array.from(track.children).forEach((child) => observer.observe(child));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length]);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: [`start ${HEADER}px`, "end end"],
  });
  const x = useTransform(scrollYProgress, [0, 1], [0, -distance]);

  // Tabbing to an off-screen card scrolls the page to bring that card into view.
  const revealItem = (index: number) => {
    const container = containerRef.current;
    if (reduced || !container || items.length < 2) return;
    const progress = index / (items.length - 1);
    const pageTop = container.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: pageTop - HEADER + progress * (distance + HEADER), behavior: "smooth" });
  };

  const isStatic = reduced || distance === 0;

  return (
    <div
      ref={containerRef}
      className={`hscroll ${isStatic ? "is-static" : ""}`}
      style={isStatic ? undefined : ({ height: `calc(100svh + ${distance}px)` } as CSSProperties)}
    >
      <div className="hscroll-sticky">
        <div className="hscroll-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          {action && (
            <button className="line-button" onClick={onAction}>
              {action}
              <Icon name="arrow-right" size={14} />
            </button>
          )}
        </div>

        <motion.div ref={trackRef} className="hscroll-track" style={isStatic ? undefined : { x }}>
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="hscroll-item"
              onClick={item.onClick}
              onFocus={() => revealItem(i)}
              style={{ "--tint": TINTS[i % TINTS.length] } as CSSProperties}
            >
              <img
                src={item.image}
                alt=""
                loading="lazy"
                draggable={false}
                onError={(event) => {
                  if (event.currentTarget.src !== fallbackImage) event.currentTarget.src = fallbackImage;
                }}
              />
              {item.tag && <span className="hscroll-tag">{item.tag}</span>}
              <span className="hscroll-content">
                <span className="hscroll-number">{String(i + 1).padStart(2, "0")}</span>
                {item.kicker && <span className="hscroll-kicker">{item.kicker}</span>}
                <strong>{item.label}</strong>
              </span>
            </button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
