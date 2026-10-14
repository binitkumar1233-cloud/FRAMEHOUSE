// Download limits per subscription plan.
// daily/monthly: counted downloads allowed in each period.
// maxDevices:    devices that can be registered for downloads.
// concurrent:    downloads that can stream at the same time.
const DOWNLOAD_PLANS = {
  Free: { daily: 1, monthly: 10, maxDevices: 1, concurrent: 1 },
  Bronze: { daily: 5, monthly: 60, maxDevices: 2, concurrent: 2 },
  Silver: { daily: 15, monthly: 200, maxDevices: 3, concurrent: 3 },
  Gold: { daily: 40, monthly: 600, maxDevices: 5, concurrent: 4 },
};

module.exports = {
  DOWNLOAD_PLANS,

  // Downloading the same video again within this window is not counted again.
  DEDUP_WINDOW_MS: 24 * 60 * 60 * 1000,

  // How long a download link stays valid. Unused links return their quota.
  LINK_TTL_SECONDS: 15 * 60,

  // A download with no activity for this long is marked interrupted.
  STALL_AFTER_MS: 30 * 60 * 1000,

  // Download requests allowed per user per minute (stops refresh spam).
  REQUESTS_PER_MINUTE: 12,

  // Device removals allowed per 30 days, so the device limit can't be
  // bypassed by removing and re-adding devices over and over.
  DEVICE_CHANGES_PER_30_DAYS: 3,

  // Downloads only from devices registered to the account (set to "false" to turn off).
  REQUIRE_REGISTERED_DEVICE: process.env.DOWNLOAD_REQUIRE_REGISTERED_DEVICE !== "false",

  // Daily quotas reset at midnight in this timezone.
  TIMEZONE: process.env.DOWNLOAD_TIMEZONE || "Asia/Kolkata",
};
