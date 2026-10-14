const PremiumUnlock = require("../models/PremiumUnlock");
const { rankOf, qualityLabel } = require("../config/plans");
const { periodInfo } = require("../utils/periods");
const { TIMEZONE } = require("../config/downloadPlans");
const { subscriptionState, usageFor } = require("./subscriptionService");

/** Lowest plan that can watch the video right now, and why. */
const requiredPlanFor = (video, now = new Date()) => {
  const base = video.minPlan || (video.premium ? "Bronze" : "Free");
  const early = video.earlyAccessUntil && new Date(video.earlyAccessUntil) > now;

  if (early && rankOf(base) < rankOf("Silver")) {
    return { plan: "Silver", reason: "early-access", until: video.earlyAccessUntil };
  }
  return { plan: base, reason: base === "Gold" ? "exclusive" : base === "Free" ? null : "premium", until: null };
};

/** Best rendition the plan may stream. */
const pickSource = (video, maxQuality) => {
  const allowed = (video.sources || [])
    .filter((source) => source?.url && source.quality <= maxQuality)
    .sort((a, b) => b.quality - a.quality);
  if (allowed.length) return { url: allowed[0].url, quality: allowed[0].quality };
  return { url: video.videoUrl, quality: null };
};

/**
 * Decides whether `user` may play `video`.
 * Returns { ok: true, ... } or { ok: false, status, code, message, ... }.
 */
const checkPlayback = async (user, video) => {
  const state = subscriptionState(user);
  const required = requiredPlanFor(video);
  let unlockedWithAllowance = false;

  if (rankOf(state.plan) < rankOf(required.plan)) {
    const canUseAllowance = state.plan === "Free" && required.plan === "Bronze" && required.reason === "premium";

    if (!canUseAllowance) {
      const message =
        required.reason === "exclusive"
          ? "This is an exclusive course for Gold members."
          : required.reason === "early-access"
          ? `This is an early-access release for Silver and Gold members until ${new Date(required.until).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}.`
          : `This video needs the ${required.plan} plan or higher.`;
      return { ok: false, status: 403, code: "upgrade-required", requiredPlan: required.plan, reason: required.reason, message };
    }

    const { monthKey } = periodInfo(TIMEZONE);
    const already = await PremiumUnlock.exists({ user: user._id, video: video._id, monthKey });
    if (!already) {
      const usage = await usageFor(user, state);
      const remaining = usage.premiumUnlocks.remaining;
      return remaining > 0
        ? {
            ok: false,
            status: 403,
            code: "unlock-available",
            requiredPlan: "Bronze",
            remaining,
            limit: usage.premiumUnlocks.limit,
            message: `Free members can watch ${usage.premiumUnlocks.limit} premium videos a month. You have ${remaining} left.`,
          }
        : {
            ok: false,
            status: 403,
            code: "upgrade-required",
            requiredPlan: "Bronze",
            reason: "premium",
            resetsAt: usage.premiumUnlocks.resetsAt,
            message: `You've watched your ${usage.premiumUnlocks.limit} free premium videos this month. Upgrade to keep watching.`,
          };
    }
    unlockedWithAllowance = true;
  }

  const usage = await usageFor(user, state);
  if (usage.watch.limitSeconds !== null && usage.watch.remainingSeconds <= 0) {
    return {
      ok: false,
      status: 403,
      code: "watch-limit",
      requiredPlan: state.plan === "Free" ? "Bronze" : "Silver",
      resetsAt: usage.watch.resetsAt,
      message: `You've reached today's ${Math.round(usage.watch.limitSeconds / 60)}-minute watch limit on the ${state.plan} plan.`,
    };
  }

  const source = pickSource(video, state.limits.maxQuality);
  return {
    ok: true,
    state,
    usage,
    source,
    playback: {
      plan: state.plan,
      maxQuality: qualityLabel(state.limits.maxQuality),
      quality: source.quality ? qualityLabel(source.quality) : null,
      ads: state.limits.ads,
      unlockedWithAllowance,
      watch: usage.watch,
    },
  };
};

module.exports = { requiredPlanFor, pickSource, checkPlayback };
