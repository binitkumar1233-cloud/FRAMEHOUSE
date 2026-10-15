import { useEffect, useRef, useState } from "react";
import type { User, View } from "../types";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "./Icon";
import { BASE, FAST } from "./motionTokens";
import logo from "../assets/logo.svg";

type NavbarProps = {
  user: User | null;
  view: View;
  navigate: (view: View) => void;
  openAuth: () => void;
  logout: () => void;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
};

const navItems: { view: View; label: string }[] = [
  { view: "home", label: "Home" },
  { view: "browse", label: "Browse" },
  { view: "pricing", label: "Pricing" },
];

export function Navbar({
  user,
  view,
  navigate,
  openAuth,
  logout,
  searchQuery = "",
  onSearchChange,
  onSearchSubmit,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setMobileOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const go = (next: View) => {
    navigate(next);
    setMenuOpen(false);
    setMobileOpen(false);
  };

  const submitSearch = () => {
    onSearchSubmit?.();
    setMobileOpen(false);
  };

  const handleLogout = () => {
    setMenuOpen(false);
    setMobileOpen(false);
    logout();
  };

  return (
    <header className="topbar">
      {/* Mobile menu */}
      <button
        className="mobile-menu-toggle"
        onClick={() => setMobileOpen((current) => !current)}
        aria-label={
          mobileOpen ? "Close navigation menu" : "Open navigation menu"
        }
        aria-expanded={mobileOpen}
        aria-controls="mobile-navigation"
      >
        <Icon name={mobileOpen ? "close" : "menu"} size={18} />
      </button>

      {/* Brand */}
      <button
        className="brand"
        onClick={() => go("home")}
        aria-label="Go to Framehouse home"
      >
        <img className="brand-logo" src={logo} alt="" />

        <span>
          FRAME
          <span className="brand-accent">HOUSE</span>
        </span>
      </button>

      {/* Desktop navigation */}
      <nav className="desktop-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.view}
            className={view === item.view ? "active" : ""}
            onClick={() => go(item.view)}
            aria-current={view === item.view ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}

        {user && (
          <button
            className={view === "meetings" ? "active" : ""}
            onClick={() => go("meetings")}
            aria-current={view === "meetings" ? "page" : undefined}
          >
            Meetings
          </button>
        )}

        {user?.role === "admin" && (
          <button
            className={view === "admin" ? "active" : ""}
            onClick={() => go("admin")}
            aria-current={view === "admin" ? "page" : undefined}
          >
            Admin Panel
          </button>
        )}

        {user?.role === "admin" && (
          <button
            className={view === "moderation" ? "active" : ""}
            onClick={() => go("moderation")}
            aria-current={view === "moderation" ? "page" : undefined}
          >
            Moderation
          </button>
        )}
      </nav>

      {/* Right actions */}
      <div className="topbar-actions">
        <form
          className="nav-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="2"
            />

            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <input
            type="search"
            placeholder="Search videos"
            aria-label="Search videos"
            value={searchQuery}
            onChange={(event) =>
              onSearchChange?.(event.target.value)
            }
          />
        </form>

        {user ? (
          <div className="user-menu" ref={menuRef}>
            <button
              className="avatar-button"
              onClick={() =>
                setMenuOpen((current) => !current)
              }
              aria-label="Open account menu"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              {user.name?.slice(0, 1).toUpperCase() || "U"}
            </button>

            {menuOpen && (
              <div
                className="user-menu-panel"
                role="menu"
              >
                <div className="user-menu-header">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>

                <button
                  role="menuitem"
                  onClick={() => go("profile")}
                >
                  Profile
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("dashboard")}
                >
                  My Library
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("downloads")}
                >
                  Downloaded videos
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("subscription")}
                >
                  Subscription
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("meetings")}
                >
                  Meetings
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("settings")}
                >
                  Settings
                </button>

                <button
                  role="menuitem"
                  onClick={() => go("security")}
                >
                  Account security
                </button>

                {user.role === "admin" && (
                  <button
                    role="menuitem"
                    onClick={() => go("admin")}
                  >
                    Admin Panel
                  </button>
                )}

                {user.role === "admin" && (
                  <button
                    role="menuitem"
                    onClick={() => go("moderation")}
                  >
                    Moderation
                  </button>
                )}

                <button
                  role="menuitem"
                  className="danger"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              className="text-button"
              onClick={openAuth}
            >
              Sign in
            </button>

            <button
              className="small-primary"
              onClick={openAuth}
            >
              Get started
            </button>
          </>
        )}
      </div>

      {/* Mobile navigation */}
      {createPortal(
      <AnimatePresence>
      {mobileOpen && (
        <motion.div
          id="mobile-navigation"
          className="mobile-nav-drawer"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0, transition: BASE }}
          exit={{ opacity: 0, y: -8, transition: FAST }}
        >
          <form
            className="nav-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
                stroke="currentColor"
                strokeWidth="2"
              />

              <path
                d="m20 20-3.5-3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>

            <input
              type="search"
              placeholder="Search videos"
              aria-label="Search videos"
              value={searchQuery}
              onChange={(event) =>
                onSearchChange?.(event.target.value)
              }
            />
          </form>

          <nav aria-label="Mobile navigation">
            {navItems.map((item) => (
              <button
                key={item.view}
                className={
                  view === item.view ? "active" : ""
                }
                aria-current={view === item.view ? "page" : undefined}
                onClick={() => go(item.view)}
              >
                {item.label}
              </button>
            ))}

            {user && (
              <>
                <button
                  className={
                    view === "meetings" ? "active" : ""
                  }
                  aria-current={view === "meetings" ? "page" : undefined}
                  onClick={() => go("meetings")}
                >
                  Meetings
                </button>

                <button
                  className={view === "dashboard" ? "active" : ""}
                  aria-current={view === "dashboard" ? "page" : undefined}
                  onClick={() => go("dashboard")}
                >
                  My Library
                </button>

                <button
                  className={view === "downloads" ? "active" : ""}
                  aria-current={view === "downloads" ? "page" : undefined}
                  onClick={() => go("downloads")}
                >
                  Downloaded videos
                </button>

                <button
                  className={view === "subscription" ? "active" : ""}
                  aria-current={view === "subscription" ? "page" : undefined}
                  onClick={() => go("subscription")}
                >
                  Subscription
                </button>

                <button
                  className={view === "settings" ? "active" : ""}
                  aria-current={view === "settings" ? "page" : undefined}
                  onClick={() => go("settings")}
                >
                  Settings
                </button>

                <button
                  className={view === "security" ? "active" : ""}
                  aria-current={view === "security" ? "page" : undefined}
                  onClick={() => go("security")}
                >
                  Account security
                </button>
              </>
            )}

            {user?.role === "admin" && (
              <>
                <button
                  className={
                    view === "admin" ? "active" : ""
                  }
                  aria-current={view === "admin" ? "page" : undefined}
                  onClick={() => go("admin")}
                >
                  Admin Panel
                </button>

                <button
                  className={view === "moderation" ? "active" : ""}
                  aria-current={view === "moderation" ? "page" : undefined}
                  onClick={() => go("moderation")}
                >
                  Moderation
                </button>
              </>
            )}
          </nav>

          {user ? (
            <>
              <button
                className="small-primary full"
                onClick={() => go("profile")}
              >
                Profile
              </button>

              <button
                className="text-button"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              className="small-primary full"
              onClick={() => {
                setMobileOpen(false);
                openAuth();
              }}
            >
              Sign in
            </button>
          )}
        </motion.div>
      )}
      </AnimatePresence>,
      document.body
      )}
    </header>
  );
}