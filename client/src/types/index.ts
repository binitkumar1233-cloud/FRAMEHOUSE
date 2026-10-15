export type View =
  | "home"
  | "browse"
  | "dashboard"
  | "downloads"
  | "pricing"
  | "subscription"
  | "profile"
  | "settings"
  | "watch"
  | "admin"
  | "meetings"
  | "meeting"
  | "security"
  | "moderation";

export type AuthMode = "login" | "register";

export type PlanName = "Bronze" | "Silver" | "Gold";

export type User = {
  _id?: string;
  name: string;
  email: string;
  role?: string;
  subscriptionPlan?: PlanName | string;
  theme?: "light" | "dark";
  themeSource?: "auto" | "manual";
};

export type Video = {
  _id?: string;

  title: string;
  description?: string;

  category: string;

  duration: string;
  views: number | string;

  
  image?: string;
  thumbnail?: string;

  
  videoUrl?: string;
  sources?: { quality: number; url: string }[];
  captions?: { language: string; label: string; url: string; default?: boolean }[];

  premium?: boolean;
  locked?: boolean;
  requiredPlan?: "Free" | "Bronze" | "Silver" | "Gold";
  accessReason?: "premium" | "early-access" | "exclusive" | null;
};

export type Plan = {
  name: PlanName;
  price: number;
  description: string;
  features: string[];
  popular?: boolean;
};