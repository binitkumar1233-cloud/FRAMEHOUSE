import { lazy, Suspense, useEffect, useRef, useState } from "react";

// The shader library is sizeable and only needed near the bottom of the home
// page, so it downloads when the banner is about to scroll into view.
const ShaderShowcase = lazy(() => import("./ShaderShowcase"));

export function ShaderBanner({
  signedIn,
  onPrimary,
  onSecondary,
}: {
  signedIn: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [near]);

  return (
    <section ref={sectionRef} className="shader-banner" aria-label="Join Framehouse">
      {near ? (
        <Suspense fallback={<div className="shader-hero shader-hero-loading" />}>
          <ShaderShowcase
            badge="Now streaming in 4K"
            title="Cinematic"
            emphasis="Stories"
            subtitle="without limits"
            description="Stream premium films, save videos to watch offline, and meet face to face. All from one membership."
            primaryLabel={signedIn ? "Browse the library" : "Get started"}
            secondaryLabel="View plans"
            onPrimary={onPrimary}
            onSecondary={onSecondary}
          />
        </Suspense>
      ) : (
        <div className="shader-hero shader-hero-loading" />
      )}
    </section>
  );
}
