const Download = require("../models/Download");
const DownloadQuota = require("../models/DownloadQuota");
const DeviceSession = require("../models/DeviceSession");
const {
  DOWNLOAD_PLANS,
  LINK_TTL_SECONDS,
  STALL_AFTER_MS,
  DEVICE_CHANGES_PER_30_DAYS,
  TIMEZONE,
} = require("../config/downloadPlans");
const { periodInfo } = require("../utils/periods");

const PAID_PLANS = ["Bronze", "Silver", "Gold"];

// ============================================================
// PLAN
// ============================================================

/** The plan whose limits apply right now. An expired paid plan counts as Free. */
const effectivePlan = (user) => {
  const plan = user?.subscriptionPlan;
  const active = PAID_PLANS.includes(plan) && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date();
  return {
    plan: active ? plan : "Free",
    subscriptionActive: Boolean(active),
    subscriptionExpired: PAID_PLANS.includes(plan) && !active,
    expiresAt: active ? user.subscriptionExpiry : null,
  };
};

// ============================================================
// QUOTA COUNTERS
// ============================================================

const ensureCounter = async (userId, period, key) => {
  try {
    await DownloadQuota.updateOne({ user: userId, period, key }, { $setOnInsert: { used: 0 } }, { upsert: true });
  } catch (error) {
    // Two requests created the same counter at once; the other one won.
    if (error.code !== 11000) throw error;
  }
};

/**
 * Atomically takes one download from today's and this month's quota.
 * Returns { ok: false, limit: "daily" | "monthly" } when either is used up.
 */
const reserveQuota = async (userId, plan, periods) => {
  const limits = DOWNLOAD_PLANS[plan];
  await ensureCounter(userId, "day", periods.dayKey);
  await ensureCounter(userId, "month", periods.monthKey);

  const day = await DownloadQuota.findOneAndUpdate(
    { user: userId, period: "day", key: periods.dayKey, used: { $lt: limits.daily } },
    { $inc: { used: 1 } },
    { returnDocument: "after" }
  );
  if (!day) return { ok: false, limit: "daily" };

  const month = await DownloadQuota.findOneAndUpdate(
    { user: userId, period: "month", key: periods.monthKey, used: { $lt: limits.monthly } },
    { $inc: { used: 1 } },
    { returnDocument: "after" }
  );
  if (!month) {
    await DownloadQuota.updateOne({ user: userId, period: "day", key: periods.dayKey, used: { $gt: 0 } }, { $inc: { used: -1 } });
    return { ok: false, limit: "monthly" };
  }

  return { ok: true };
};

/**
 * Gives a download's quota back (failed before any data, or link unused).
 * Safe to call more than once: only the first call finds counted=true.
 */
const refundDownload = async (downloadId, detail) => {
  const download = await Download.findOneAndUpdate(
    { _id: downloadId, counted: true },
    { $set: { counted: false }, $push: { history: { event: "refunded", detail } } },
    { returnDocument: "after" }
  );
  if (!download) return false;

  await DownloadQuota.updateOne({ user: download.user, period: "day", key: download.dayKey, used: { $gt: 0 } }, { $inc: { used: -1 } });
  await DownloadQuota.updateOne({ user: download.user, period: "month", key: download.monthKey, used: { $gt: 0 } }, { $inc: { used: -1 } });
  return true;
};

/** Returns quota for links that were never used, and closes stalled downloads. */
const cleanUpStale = async (userId) => {
  const now = Date.now();

  const unused = await Download.find({
    user: userId,
    status: "authorized",
    authorizedAt: { $lt: new Date(now - LINK_TTL_SECONDS * 1000) },
  }).select("_id");

  for (const { _id } of unused) {
    const expired = await Download.findOneAndUpdate(
      { _id, status: "authorized" },
      {
        $set: { status: "expired", reason: "The download link wasn't used in time. Your quota was returned." },
        $push: { history: { event: "expired" } },
      }
    );
    if (expired) await refundDownload(_id, "Link expired unused");
  }

  await Download.updateMany(
    { user: userId, status: "downloading", lastActivityAt: { $lt: new Date(now - STALL_AFTER_MS) } },
    {
      $set: { status: "interrupted", reason: "The download stopped before it finished. Download it again within 24 hours at no extra cost." },
      $push: { history: { event: "interrupted", detail: "No activity for 30 minutes" } },
    }
  );
};

const quotaSummary = async (user) => {
  const { plan, subscriptionActive, subscriptionExpired, expiresAt } = effectivePlan(user);
  const limits = DOWNLOAD_PLANS[plan];
  const periods = periodInfo(TIMEZONE);

  const counters = await DownloadQuota.find({
    user: user._id,
    $or: [
      { period: "day", key: periods.dayKey },
      { period: "month", key: periods.monthKey },
    ],
  }).lean();

  const usedToday = counters.find((c) => c.period === "day")?.used ?? 0;
  const usedThisMonth = counters.find((c) => c.period === "month")?.used ?? 0;
  const devices = await DeviceSession.countDocuments({ user: user._id, trusted: true });

  return {
    plan,
    subscriptionActive,
    subscriptionExpired,
    subscriptionExpiresAt: expiresAt,
    daily: { limit: limits.daily, used: usedToday, remaining: Math.max(0, limits.daily - usedToday), resetsAt: periods.dayResetsAt },
    monthly: { limit: limits.monthly, used: usedThisMonth, remaining: Math.max(0, limits.monthly - usedThisMonth), resetsAt: periods.monthResetsAt },
    remaining: Math.max(0, Math.min(limits.daily - usedToday, limits.monthly - usedThisMonth)),
    devices: { registered: devices, limit: limits.maxDevices },
    concurrentLimit: limits.concurrent,
    timezone: TIMEZONE,
  };
};

// ============================================================
// DEVICES
// ============================================================

/**
 * Checks the device may download, registering it if there is a free slot.
 * Only the earliest-registered `maxDevices` devices are allowed, so a
 * downgraded plan can't keep using extra devices.
 */
const authorizeDevice = async (user, plan, device) => {
  const { maxDevices } = DOWNLOAD_PLANS[plan];
  const registered = await DeviceSession.find({ user: user._id, trusted: true }).sort({ registeredAt: 1, createdAt: 1 }).lean();
  const allowed = registered.slice(0, maxDevices).map((d) => d.deviceId);

  const touch = {
    ip: device.ip,
    userAgent: device.userAgent,
    browser: device.browser,
    os: device.os,
    deviceType: device.deviceType,
    lastUsedAt: new Date(),
  };

  if (allowed.includes(device.deviceId)) {
    await DeviceSession.updateOne({ user: user._id, deviceId: device.deviceId }, { $set: touch });
    return { ok: true };
  }

  if (registered.some((d) => d.deviceId === device.deviceId)) {
    return {
      ok: false,
      message: `Your ${plan} plan allows downloads on ${maxDevices} device${maxDevices === 1 ? "" : "s"}. Remove another device in Profile → Downloads to use this one.`,
    };
  }

  if (registered.length >= maxDevices) {
    return {
      ok: false,
      message: `You've reached your limit of ${maxDevices} download device${maxDevices === 1 ? "" : "s"} on the ${plan} plan. Remove a device in Profile → Downloads, or upgrade your plan.`,
    };
  }

  await DeviceSession.updateOne(
    { user: user._id, deviceId: device.deviceId },
    { $set: { ...touch, trusted: true, registeredAt: new Date() }, $unset: { removedAt: "" } },
    { upsert: true }
  );
  return { ok: true, registered: true };
};

const removeDevice = async (userId, deviceId) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRemovals = await DeviceSession.countDocuments({ user: userId, removedAt: { $gte: since } });
  if (recentRemovals >= DEVICE_CHANGES_PER_30_DAYS) {
    return { ok: false, message: `You can remove up to ${DEVICE_CHANGES_PER_30_DAYS} devices every 30 days.` };
  }

  const result = await DeviceSession.updateOne(
    { user: userId, deviceId, trusted: true },
    { $set: { trusted: false, removedAt: new Date() } }
  );
  return result.modifiedCount ? { ok: true } : { ok: false, message: "That device isn't registered." };
};

// ============================================================
// SERIALIZE
// ============================================================

const serializeDownload = (download) => ({
  id: download._id.toString(),
  videoId: download.video ? download.video.toString() : null,
  title: download.videoTitle,
  thumbnail: download.thumbnail,
  plan: download.plan,
  status: download.status,
  reason: download.reason,
  counted: download.counted,
  duplicate: Boolean(download.dedupOf),
  fileSize: download.fileSize ?? null,
  bytesSent: download.bytesSent ?? 0,
  browser: download.browser,
  os: download.os,
  deviceType: download.deviceType,
  requestedAt: download.createdAt,
  completedAt: download.completedAt ?? null,
});

module.exports = {
  PAID_PLANS,
  effectivePlan,
  reserveQuota,
  refundDownload,
  cleanUpStale,
  quotaSummary,
  authorizeDevice,
  removeDevice,
  serializeDownload,
};
