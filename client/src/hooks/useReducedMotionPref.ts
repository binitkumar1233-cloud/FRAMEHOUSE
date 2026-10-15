import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const read = () =>
  typeof window !== "undefined" &&
  (document.documentElement.classList.contains("reduce-motion") || window.matchMedia?.(QUERY).matches === true);

/**
 * True when motion should be reduced: either the app's own "Reduce motion"
 * setting (the reduce-motion class on <html>) or the operating system setting.
 */
export function useReducedMotionPref() {
  const [reduced, setReduced] = useState(read);

  useEffect(() => {
    const update = () => setReduced(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const media = window.matchMedia?.(QUERY);
    media?.addEventListener?.("change", update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", update);
    };
  }, []);

  return reduced;
}
