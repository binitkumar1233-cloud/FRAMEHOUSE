import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

type ShareMenuProps = {
  url: string;
  title: string;
  label?: string;
  className?: string;
  onNotify?: (message: string) => void;
};

const targets = (url: string, title: string) => {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const both = encodeURIComponent(`${title} ${url}`);
  return [
    { name: "WhatsApp", color: "#25d366", href: `https://wa.me/?text=${both}` },
    { name: "Facebook", color: "#1877f2", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "X (Twitter)", color: "#111111", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { name: "Telegram", color: "#229ed9", href: `https://t.me/share/url?url=${u}&text=${t}` },
    { name: "LinkedIn", color: "#0a66c2", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: "Reddit", color: "#ff4500", href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { name: "Pinterest", color: "#e60023", href: `https://pinterest.com/pin/create/button/?url=${u}&description=${t}` },
    { name: "Email", color: "#6366f1", href: `mailto:?subject=${t}&body=${both}` },
    { name: "SMS", color: "#34a853", href: `sms:?&body=${both}` },
  ];
};

export function ShareMenu({ url, title, label = "Share", className = "secondary-button", onNotify }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onNotify?.("Link copied to clipboard.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify?.("Unable to copy the link.");
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
      setOpen(false);
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="share-menu" ref={rootRef}>
      <button type="button" className={className} onClick={() => setOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="share" size={16} />
        {label}
      </button>
      {open && createPortal(
        <div className="share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="share-popover" role="dialog" aria-label="Share this link">
          <div className="share-popover-head">
            Share via
            <button type="button" className="share-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="share-grid">
            {targets(url, title).map((target) => (
              <a
                key={target.name}
                className="share-target"
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span className="share-dot" style={{ background: target.color }}>{target.name[0]}</span>
                {target.name}
              </a>
            ))}
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button type="button" className="share-target" onClick={() => void nativeShare()}>
                <span className="share-dot" style={{ background: "#64748b" }}>⋯</span>
                More apps
              </button>
            )}
          </div>
          <div className="share-link-row">
            <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} aria-label="Link" />
            <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  );
}
