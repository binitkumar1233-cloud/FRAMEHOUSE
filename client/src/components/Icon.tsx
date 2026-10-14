import type { ReactNode } from "react";

type IconName =
  | "thumbs-up"
  | "thumbs-down"
  | "reply"
  | "flag"
  | "edit"
  | "trash"
  | "globe"
  | "pin"
  | "chevron-down"
  | "monitor"
  | "phone"
  | "tablet"
  | "sun"
  | "moon"
  | "arrow-right"
  | "arrow-up-right"
  | "arrow-left"
  | "play"
  | "plus"
  | "search"
  | "menu"
  | "close"
  | "check"
  | "sparkle"
  | "film"
  | "video"
  | "share"
  | "hd"
  | "shield"
  | "users"
  | "mic"
  | "mic-off"
  | "video-off"
  | "screen"
  | "hand"
  | "message"
  | "settings"
  | "phone-off"
  | "lock"
  | "unlock"
  | "record"
  | "flip"
  | "more"
  | "paperclip"
  | "smile"
  | "send"
  | "copy"
  | "file"
  | "download"
  | "crown"
  | "user-x"
  | "pause"
  | "rewind"
  | "forward"
  | "volume"
  | "volume-off"
  | "maximize"
  | "pip"
  | "theater"
  | "eye"
  | "eye-off";

const paths: Record<IconName, ReactNode> = {
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-up-right": <path d="M7 17 17 7M8 7h9v9" />,
  "arrow-left": <path d="M19 12H5M11 18l-6-6 6-6" />,
  play: <path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  sparkle: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8L12 3.5Z" />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
      <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
    </>
  ),
  hd: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M7 9v6M7 12h3.5M10.5 9v6M14 9v6h1.8a3 3 0 0 0 0-6H14Z" />
    </>
  ),
  shield: <path d="M12 3 5 6v5.5c0 4.3 2.9 8.1 7 9.5 4.1-1.4 7-5.2 7-9.5V6l-7-3Z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  "mic-off": (
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10 5.5M12 17.5V21M3.5 3.5l17 17" />
    </>
  ),
  "video-off": (
    <>
      <path d="M10.5 6H13a2.5 2.5 0 0 1 2.5 2.5v2.2l6-3.7v10l-3-1.8M15.5 15.5v0A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 4.8 6" />
      <path d="M3 3l18 18" />
    </>
  ),
  screen: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M9 10.5l3-3 3 3M12 7.5v6" />
    </>
  ),
  hand: <path d="M7.5 12V6.5a1.5 1.5 0 0 1 3 0V11M10.5 11V4.5a1.5 1.5 0 0 1 3 0V11M13.5 11V5.5a1.5 1.5 0 0 1 3 0V12M16.5 12V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.8a6 6 0 0 1-4.8-2.4L4 15.1a1.5 1.5 0 0 1 2.3-1.9l1.2 1.3" />,
  message: <path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20.5l1.4-4.6A7.5 7.5 0 1 1 20 12.5Z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  "phone-off": <path d="M3.6 13.7c4.7-4.2 12.1-4.2 16.8 0 .6.6.6 1.5 0 2.1l-1.6 1.5c-.5.5-1.3.5-1.9.1l-1.8-1.3c-.4-.3-.6-.8-.5-1.3l.2-1.3a11 11 0 0 0-5.6 0l.2 1.3c.1.5-.1 1-.5 1.3l-1.8 1.3c-.6.4-1.4.4-1.9-.1l-1.6-1.5c-.6-.6-.6-1.5 0-2.1Z" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </>
  ),
  flip: (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  paperclip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15" />,
  crown: <path d="m3.5 8 4.2 3.6L12 5l4.3 6.6L20.5 8l-1.8 10.5H5.3L3.5 8Z" />,
  "user-x": (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6 1.6 0 3 .4 4.1 1.2M16 14l5 5M21 14l-5 5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3c2.1.7 3.5 2.8 3.5 5.7" />
    </>
  ),
  pause: (
    <>
      <rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  rewind: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4v4.5h4.5" />
      <text x="12" y="15.4" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">10</text>
    </>
  ),
  forward: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
      <text x="12" y="15.4" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">10</text>
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  "volume-off": (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  theater: <rect x="2.5" y="6.5" width="19" height="11" rx="2" />,
  "thumbs-up": <path d="M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1H7Zm0 0 3.2-6.2a1.7 1.7 0 0 1 3.2.9V9h5a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.6A2.3 2.3 0 0 1 16.7 19.5H9a2 2 0 0 1-2-2" />,
  "thumbs-down": <path d="M7 13.5V4H4.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1H7Zm0 0 3.2 6.2a1.7 1.7 0 0 0 3.2-.9V15h5a1.8 1.8 0 0 0 1.8-2.1l-1.2-6.6A2.3 2.3 0 0 0 16.7 4.5H9a2 2 0 0 0-2 2" />,
  reply: <path d="M10 8 4.5 12.5 10 17M5 12.5h8a6 6 0 0 1 6 6" />,
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm9-13 3 3" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7m-7 0 .8 12.5h7.4L16.5 7M10 11v5m4-5v5" />,
  globe: <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5S14.4 18.200 12 20.500C9.600 18.200 8.400 15.400 8.400 12S9.600 5.800 12 3.500Z" />,
  pin: <path d="M12 21s6.500-5.700 6.500-11a6.500 6.500 0 1 0-13 0c0 5.300 6.500 11 6.500 11Zm0-8.200a2.600 2.600 0 1 0 0-5.200 2.600 2.600 0 0 0 0 5.200Z" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  monitor: <path d="M3.5 5.5h17v11h-17zM9 20.5h6M12 16.5v4" />,
  phone: <path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5ZM11 18h2" />,
  tablet: <path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5ZM11 18h2" />,
  sun: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  eye: (
    <>
      <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6.2 0 9.5 6 9.5 6a15 15 0 0 1-3.1 3.7M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.3 6 9.5 6c.9 0 1.8-.2 2.6-.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
