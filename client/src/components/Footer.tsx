import type { View } from "../types";
import { Reveal } from "./ScrollEffects";
import logo from "../assets/logo.svg";

const footerColumns: {
  heading: string;
  links: { label: string; view: View }[];
}[] = [
  {
    heading: "Explore",
    links: [
      { label: "Home", view: "home" },
      { label: "Browse", view: "browse" },
      { label: "Pricing", view: "pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "My Library", view: "dashboard" },
      { label: "Downloads", view: "downloads" },
      { label: "Meetings", view: "meetings" },
      { label: "Settings", view: "settings" },
    ],
  },
];

export function Footer({
  navigate,
}: {
  navigate: (view: View) => void;
}) {
  const currentYear = new Date().getFullYear();

  return (
    <Reveal as="footer" className="site-footer" lift={false}>
      <div className="footer-inner">
        {/* Brand */}
        <div className="footer-brand">
          <button
            className="brand"
            onClick={() => navigate("home")}
            aria-label="Go to Framehouse home"
          >
            <img className="brand-logo" src={logo} alt="" />

            <span>
              FRAME
              <span className="brand-accent">HOUSE</span>
            </span>
          </button>

          <p>
            A considered home for premium video,
            cinematic stories, and real-time meetings.
          </p>

          <span className="footer-status">
            <span className="footer-status-dot" />
            All systems operational
          </span>
        </div>

        {/* Navigation */}
        <div className="footer-links">
          {footerColumns.map((column) => (
            <div
              className="footer-column"
              key={column.heading}
            >
              <span className="footer-heading">
                {column.heading.toUpperCase()}
              </span>

              {column.links.map((link) => (
                <button
                  key={link.view}
                  onClick={() => navigate(link.view)}
                >
                  {link.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer bottom */}
        <div className="footer-bottom">
          <small>
            © {currentYear} Framehouse Studio
          </small>

          <span className="footer-tagline">
            WATCH · CONNECT · EXPERIENCE
          </span>
        </div>
      </div>
    </Reveal>
  );
}