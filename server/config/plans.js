const { DOWNLOAD_PLANS } = require("./downloadPlans");

// Lowest to highest. A plan includes everything below it.
const PLAN_ORDER = ["Free", "Bronze", "Silver", "Gold"];
const PAID_PLANS = ["Bronze", "Silver", "Gold"];

const CYCLES = {
  monthly: { label: "Monthly", months: 1 },
  quarterly: { label: "Quarterly", months: 3 },
  yearly: { label: "Yearly", months: 12 },
};

// null = unlimited.
const PLANS = {
  Free: {
    name: "Free",
    tagline: "Try Framehouse with the essentials",
    prices: null,
    limits: {
      premiumVideosPerMonth: 3,
      dailyWatchMinutes: 60,
      maxQuality: 480,
      ads: true,
      earlyAccess: false,
      exclusiveContent: false,
    },
  },
  Bronze: {
    name: "Bronze",
    tagline: "Premium films without the limits",
    prices: { monthly: 199, quarterly: 549, yearly: 1999 },
    limits: {
      premiumVideosPerMonth: null,
      dailyWatchMinutes: 240,
      maxQuality: 720,
      ads: false,
      earlyAccess: false,
      exclusiveContent: false,
    },
  },
  Silver: {
    name: "Silver",
    tagline: "The complete everyday experience",
    popular: true,
    prices: { monthly: 399, quarterly: 1099, yearly: 3999 },
    limits: {
      premiumVideosPerMonth: null,
      dailyWatchMinutes: null,
      maxQuality: 1080,
      ads: false,
      earlyAccess: true,
      exclusiveContent: false,
    },
  },
  Gold: {
    name: "Gold",
    tagline: "Everything, including exclusive courses",
    prices: { monthly: 699, quarterly: 1899, yearly: 6999 },
    limits: {
      premiumVideosPerMonth: null,
      dailyWatchMinutes: null,
      maxQuality: 2160,
      ads: false,
      earlyAccess: true,
      exclusiveContent: true,
    },
  },
};

const POLICIES = {
  renewal:
    "Plans don't renew or charge automatically. We email you 3 days before your plan ends, and renewing adds the new period to the time you have left.",
  upgrade:
    "Upgrade any time. The unused value of your current plan is taken off the price, and the new plan starts immediately.",
  downgrade:
    "Downgrades take effect when your current plan ends. You keep your current features until then.",
  cancellation:
    "Cancel any time. You keep access until the end of the period you paid for. Payments aren't refunded for partial periods.",
  expiry:
    "When a plan ends you move to Free automatically. Your watch history, downloads list and account stay as they are.",
};

const RENEW_MAX_AHEAD_MONTHS = 24;
const REMINDER_DAYS_BEFORE = 3;
const ORDER_REUSE_MINUTES = 15;

const rankOf = (plan) => Math.max(0, PLAN_ORDER.indexOf(plan));

const qualityLabel = (height) => (height >= 2160 ? "4K" : `${height}p`);

// Human-readable feature rows for comparison tables and emails.
const featureRows = () => {
  const value = (plan, fn) => fn(PLANS[plan].limits, plan);
  const row = (label, fn) => ({ label, values: Object.fromEntries(PLAN_ORDER.map((p) => [p, value(p, fn)])) });

  return [
    row("Premium videos", (l) => (l.premiumVideosPerMonth === null ? "Unlimited" : `${l.premiumVideosPerMonth} a month`)),
    row("Daily watch time", (l) => (l.dailyWatchMinutes === null ? "Unlimited" : l.dailyWatchMinutes === 60 ? "1 hour" : l.dailyWatchMinutes > 60 ? `${l.dailyWatchMinutes / 60} hours` : `${l.dailyWatchMinutes} minutes`)),
    row("Streaming quality", (l) => `Up to ${qualityLabel(l.maxQuality)}`),
    row("Downloads", (_l, p) => `${DOWNLOAD_PLANS[p].daily} a day`),
    row("Download devices", (_l, p) => String(DOWNLOAD_PLANS[p].maxDevices)),
    row("Ad-free viewing", (l) => !l.ads),
    row("Early access to new releases", (l) => l.earlyAccess),
    row("Exclusive premium courses", (l) => l.exclusiveContent),
  ];
};

module.exports = {
  PLAN_ORDER,
  PAID_PLANS,
  CYCLES,
  PLANS,
  POLICIES,
  RENEW_MAX_AHEAD_MONTHS,
  REMINDER_DAYS_BEFORE,
  ORDER_REUSE_MINUTES,
  rankOf,
  qualityLabel,
  featureRows,
};
