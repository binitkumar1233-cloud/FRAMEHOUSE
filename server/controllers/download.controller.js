const { Readable } = require("stream");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Download = require("../models/Download");
const DeviceSession = require("../models/DeviceSession");
const User = require("../models/User");
const Video = require("../models/Video");
const asyncHandler = require("../utils/asyncHandler");
const { periodInfo } = require("../utils/periods");
const {
  DOWNLOAD_PLANS,
  DEDUP_WINDOW_MS,
  LINK_TTL_SECONDS,
  REQUESTS_PER_MINUTE,
  REQUIRE_REGISTERED_DEVICE,
  TIMEZONE,
} = require("../config/downloadPlans");
const {
  effectivePlan,
  reserveQuota,
  refundDownload,
  cleanUpStale,
  quotaSummary,
  authorizeDevice,
  removeDevice,
  serializeDownload,
} = require("../services/downloadService");

const { rankOf } = require("../config/plans");
const { requiredPlanFor } = require("../services/accessService");

const TOKEN_PURPOSE = "video-download";

// Downloads follow the same plan levels as streaming (Gold-only courses, early access...).
// A Free member's monthly premium allowance covers watching, not downloading.
const downloadBlockReason = (video, plan, subscriptionExpired) => {
  const required = requiredPlanFor(video);
  if (rankOf(plan) >= rankOf(required.plan)) return null;
  if (subscriptionExpired && plan === "Free") return { code: "subscription-expired", message: "Your subscription has expired. Renew it to download this video." };
  const message =
    required.reason === "exclusive"
      ? "Exclusive courses can be downloaded on the Gold plan."
      : required.reason === "early-access"
      ? "Early-access releases can be downloaded on Silver and Gold."
      : `Downloading this video needs the ${required.plan} plan or higher.`;
  return { code: "subscription-required", message, requiredPlan: required.plan };
};

// ============================================================
// IN-MEMORY GUARDS (single server process)
// ============================================================

const recentRequests = new Map(); // userId -> timestamps
const activeStreams = new Map(); // userId -> Set of stream ids

const tooManyRequests = (userId) => {
  const now = Date.now();
  const times = (recentRequests.get(userId) || []).filter((t) => now - t < 60_000);
  times.push(now);
  recentRequests.set(userId, times);
  return times.length > REQUESTS_PER_MINUTE;
};

// ============================================================
// HELPERS
// ============================================================

const auditFields = (device) => ({
  ip: device?.ip,
  userAgent: device?.userAgent,
  browser: device?.browser,
  browserVersion: device?.browserVersion,
  os: device?.os,
  deviceType: device?.deviceType,
  deviceId: device?.deviceId,
});

const recordBlocked = (user, video, plan, reason, device, periods) =>
  Download.create({
    user: user._id,
    video: video?._id,
    videoTitle: video?.title,
    thumbnail: video?.thumbnail,
    plan,
    status: "blocked",
    reason,
    counted: false,
    dayKey: periods.dayKey,
    monthKey: periods.monthKey,
    ...auditFields(device),
    history: [{ event: "blocked", detail: reason, ip: device?.ip, userAgent: device?.userAgent }],
  });

const safeFilename = (title, contentType, url) => {
  const base = String(title || "video").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "video";
  const fromUrl = String(url).split("?")[0].match(/\.(mp4|webm|mov|m4v|mkv)$/i)?.[1];
  const fromType = { "video/webm": "webm", "video/quicktime": "mov" }[contentType] || "mp4";
  return `${base}.${(fromUrl || fromType).toLowerCase()}`;
};

const buildLink = (req, download, userId, deviceId) => {
  const token = jwt.sign(
    { purpose: TOKEN_PURPOSE, dl: download._id.toString(), uid: userId.toString(), dev: deviceId },
    process.env.JWT_SECRET,
    { expiresIn: LINK_TTL_SECONDS }
  );
  return `${req.protocol}://${req.get("host")}/api/downloads/file/${download._id}?token=${encodeURIComponent(token)}`;
};

// ============================================================
// POST /api/downloads/:videoId — authorize a download
// ============================================================

exports.requestDownload = asyncHandler(async (req, res) => {
  const user = req.user;
  const userId = user._id.toString();
  const device = req.device || {};
  const periods = periodInfo(TIMEZONE);
  const { plan, subscriptionExpired } = effectivePlan(user);

  if (tooManyRequests(userId)) {
    return res.status(429).json({ success: false, code: "rate-limited", message: "Too many download requests. Wait a minute and try again." });
  }

  if (!mongoose.isValidObjectId(req.params.videoId)) {
    return res.status(404).json({ success: false, message: "Video not found" });
  }

  const video = await Video.findById(req.params.videoId).lean();
  if (!video) {
    return res.status(404).json({ success: false, message: "Video not found" });
  }

  if (!video.videoUrl || !/^https?:\/\//i.test(video.videoUrl)) {
    return res.status(409).json({ success: false, code: "unavailable", message: "This video isn't available for download yet." });
  }

  // ---------- subscription / video access ----------
  const blocked = downloadBlockReason(video, plan, subscriptionExpired);
  if (blocked) {
    await recordBlocked(user, video, plan, blocked.message, device, periods);
    return res.status(403).json({ success: false, ...blocked });
  }

  // ---------- device ----------
  if (!device.deviceId) {
    return res.status(400).json({ success: false, code: "device-required", message: "This device couldn't be identified. Refresh the page and try again." });
  }

  if (REQUIRE_REGISTERED_DEVICE) {
    const deviceCheck = await authorizeDevice(user, plan, device);
    if (!deviceCheck.ok) {
      await recordBlocked(user, video, plan, deviceCheck.message, device, periods);
      return res.status(403).json({ success: false, code: "device-limit", message: deviceCheck.message });
    }
  }

  await cleanUpStale(user._id);

  // ---------- repeated clicks / refreshes: reuse the open link ----------
  const open = await Download.findOne({
    user: user._id,
    video: video._id,
    deviceId: device.deviceId,
    status: { $in: ["authorized", "downloading"] },
    authorizedAt: { $gte: new Date(Date.now() - LINK_TTL_SECONDS * 1000) },
  }).sort({ createdAt: -1 });

  if (open) {
    open.history.push({ event: "reused", detail: "Same download requested again", ip: device.ip, userAgent: device.userAgent });
    await open.save();
    return res.json({
      success: true,
      reused: true,
      counted: false,
      url: buildLink(req, open, user._id, device.deviceId),
      download: serializeDownload(open),
      quota: await quotaSummary(user),
    });
  }

  // ---------- same video within 24 hours: allowed, not counted again ----------
  const recent = await Download.findOne({
    user: user._id,
    video: video._id,
    counted: true,
    status: { $in: ["authorized", "downloading", "completed", "interrupted"] },
    createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
  }).sort({ createdAt: -1 });

  let counted = false;
  if (!recent) {
    const reservation = await reserveQuota(user._id, plan, periods);
    if (!reservation.ok) {
      const limits = DOWNLOAD_PLANS[plan];
      const reason =
        reservation.limit === "daily"
          ? `You've used all ${limits.daily} download${limits.daily === 1 ? "" : "s"} for today on the ${plan} plan.`
          : `You've used all ${limits.monthly} downloads for this month on the ${plan} plan.`;
      await recordBlocked(user, video, plan, reason, device, periods);
      return res.status(429).json({
        success: false,
        code: "quota-exceeded",
        limit: reservation.limit,
        message: reason,
        resetsAt: reservation.limit === "daily" ? periods.dayResetsAt : periods.monthResetsAt,
        quota: await quotaSummary(user),
      });
    }
    counted = true;
  }

  const download = await Download.create({
    user: user._id,
    video: video._id,
    videoTitle: video.title,
    thumbnail: video.thumbnail,
    plan,
    status: "authorized",
    reason: recent ? "Downloaded again within 24 hours, so it didn't use your quota." : undefined,
    counted,
    dedupOf: recent?._id,
    dayKey: periods.dayKey,
    monthKey: periods.monthKey,
    ...auditFields(device),
    authorizedAt: new Date(),
    history: [{ event: "authorized", detail: counted ? "Counted toward quota" : "Not counted (re-download)", ip: device.ip, userAgent: device.userAgent }],
  });

  res.status(201).json({
    success: true,
    counted,
    url: buildLink(req, download, user._id, device.deviceId),
    download: serializeDownload(download),
    quota: await quotaSummary(user),
  });
});

// ============================================================
// GET /api/downloads/file/:id?token=… — stream the file
// Uses a signed link because browser downloads can't send headers.
// ============================================================

const sendError = (res, status, message) => {
  if (res.headersSent) return res.destroy();
  res.status(status).type("text/plain; charset=utf-8").send(`${message}\n\nReturn to Framehouse to try again.`);
};

exports.streamDownload = async (req, res) => {
  const device = req.device || {};
  let payload;

  try {
    payload = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET);
  } catch {
    return sendError(res, 401, "This download link has expired or is invalid.");
  }

  if (payload.purpose !== TOKEN_PURPOSE || payload.dl !== req.params.id || !mongoose.isValidObjectId(req.params.id)) {
    return sendError(res, 401, "This download link is invalid.");
  }

  const download = await Download.findById(req.params.id);
  if (!download || download.user.toString() !== payload.uid) {
    return sendError(res, 404, "Download not found.");
  }
  if (["blocked", "failed", "expired"].includes(download.status)) {
    return sendError(res, 410, "This download is no longer available. Start a new download.");
  }

  // Re-check access at stream time: the subscription may have expired
  // or the video may have changed since the link was issued.
  const [user, video] = await Promise.all([
    User.findById(download.user).select("subscriptionPlan subscriptionExpiry"),
    download.video ? Video.findById(download.video).lean() : null,
  ]);

  const fail = async (status, reason) => {
    const nothingSent = !download.bytesSent;
    await Download.updateOne(
      { _id: download._id },
      { $set: { status: "failed", reason, lastActivityAt: new Date() }, $push: { history: { event: "failed", detail: reason, ip: device.ip, userAgent: device.userAgent } } }
    );
    if (nothingSent) await refundDownload(download._id, "Download failed before any data was sent");
    return sendError(res, status, reason);
  };

  if (!user) return fail(401, "Your account couldn't be found.");
  if (!video || !video.videoUrl) return fail(404, "This video is no longer available.");
  const lateBlock = downloadBlockReason(video, effectivePlan(user).plan, effectivePlan(user).subscriptionExpired);
  if (lateBlock) return fail(403, lateBlock.message);

  // ---------- simultaneous downloads ----------
  const userId = download.user.toString();
  const { concurrent } = DOWNLOAD_PLANS[effectivePlan(user).plan];
  const streams = activeStreams.get(userId) || new Set();
  if (streams.size >= concurrent) {
    return sendError(res, 429, `Your plan allows ${concurrent} download${concurrent === 1 ? "" : "s"} at a time. Wait for one to finish.`);
  }
  const streamId = `${download._id}-${Date.now()}-${Math.random()}`;
  streams.add(streamId);
  activeStreams.set(userId, streams);
  const releaseSlot = () => {
    streams.delete(streamId);
    if (!streams.size) activeStreams.delete(userId);
  };

  // ---------- fetch from the storage URL ----------
  const range = typeof req.headers.range === "string" && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
  const controller = new AbortController();
  const headerTimeout = setTimeout(() => controller.abort(), 20_000);
  let upstream;

  try {
    upstream = await fetch(video.videoUrl, { headers: range ? { Range: range } : {}, signal: controller.signal, redirect: "follow" });
  } catch {
    clearTimeout(headerTimeout);
    releaseSlot();
    return fail(502, "The video file couldn't be reached. Please try again later.");
  }
  clearTimeout(headerTimeout);

  if (!upstream.ok || !upstream.body) {
    releaseSlot();
    return fail(502, `The video file couldn't be downloaded (storage responded ${upstream.status}).`);
  }

  const contentType = (upstream.headers.get("content-type") || "video/mp4").split(";")[0];
  const contentLength = Number(upstream.headers.get("content-length")) || undefined;
  const contentRange = upstream.headers.get("content-range");
  const partial = upstream.status === 206 && contentRange;
  const rangeMatch = partial ? contentRange.match(/bytes (\d+)-(\d+)\/(\d+|\*)/) : null;
  const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;
  const rangeEnd = rangeMatch ? Number(rangeMatch[2]) : undefined;
  const totalSize = rangeMatch && rangeMatch[3] !== "*" ? Number(rangeMatch[3]) : partial ? undefined : contentLength;
  const resuming = rangeStart > 0 || download.attempts > 0;

  const filename = safeFilename(download.videoTitle, contentType, video.videoUrl);
  res.status(partial ? 206 : 200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (contentLength) res.setHeader("Content-Length", contentLength);
  if (partial) res.setHeader("Content-Range", contentRange);
  if (upstream.headers.get("accept-ranges") === "bytes") res.setHeader("Accept-Ranges", "bytes");

  await Download.updateOne(
    { _id: download._id },
    {
      $set: {
        status: "downloading",
        startedAt: download.startedAt || new Date(),
        lastActivityAt: new Date(),
        contentType,
        ...(totalSize ? { fileSize: totalSize } : {}),
      },
      $inc: { attempts: 1 },
      $push: {
        history: {
          event: resuming ? "resumed" : "started",
          detail: range ? `Range ${range}` : undefined,
          ip: device.ip,
          userAgent: device.userAgent,
        },
      },
    }
  );

  // ---------- pipe and track progress ----------
  let streamed = 0;
  let lastSave = Date.now();
  let settled = false;
  const body = Readable.fromWeb(upstream.body);

  const saveProgress = () =>
    Download.updateOne(
      { _id: download._id, bytesSent: { $lt: rangeStart + streamed } },
      { $set: { bytesSent: rangeStart + streamed, lastActivityAt: new Date() } }
    ).catch(() => undefined);

  body.on("data", (chunk) => {
    streamed += chunk.length;
    if (Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      void saveProgress();
    }
  });

  const settle = async (outcome, detail) => {
    if (settled) return;
    settled = true;
    releaseSlot();
    await saveProgress();

    const reachedEnd =
      outcome === "finished" &&
      (totalSize ? rangeStart + streamed >= totalSize || (rangeEnd !== undefined && rangeEnd + 1 >= totalSize) : !partial);

    if (reachedEnd) {
      await Download.updateOne(
        { _id: download._id },
        {
          $set: { status: "completed", completedAt: new Date(), lastActivityAt: new Date(), reason: download.dedupOf ? download.reason : undefined, ...(totalSize ? { fileSize: totalSize } : { fileSize: rangeStart + streamed }) },
          $push: { history: { event: "completed", bytes: rangeStart + streamed, ip: device.ip } },
        }
      );
    } else if (outcome === "finished") {
      // A partial range finished; the browser will ask for the rest.
      await Download.updateOne({ _id: download._id }, { $set: { lastActivityAt: new Date() } });
    } else {
      const nothingSent = rangeStart + streamed === 0 && !download.bytesSent;
      await Download.updateOne(
        { _id: download._id, status: { $ne: "completed" } },
        {
          $set: {
            status: nothingSent && outcome === "error" ? "failed" : "interrupted",
            reason: "The download stopped before it finished. Download it again within 24 hours at no extra cost.",
            lastActivityAt: new Date(),
          },
          $push: { history: { event: nothingSent && outcome === "error" ? "failed" : "interrupted", detail, bytes: rangeStart + streamed, ip: device.ip } },
        }
      );
      if (nothingSent && outcome === "error") await refundDownload(download._id, "No data was delivered");
    }
  };

  res.on("finish", () => void settle("finished"));
  res.on("close", () => {
    if (!res.writableFinished) {
      body.destroy();
      void settle("aborted", "Connection closed by the browser");
    }
  });
  body.on("error", (error) => {
    void settle("error", `Storage stream error: ${error.message}`);
    res.destroy(error);
  });

  body.pipe(res);
};

// ============================================================
// GET /api/downloads — the user's downloads
// ============================================================

exports.listDownloads = asyncHandler(async (req, res) => {
  await cleanUpStale(req.user._id);

  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const filter = { user: req.user._id };
  // Hide rejected attempts unless asked for; they're kept for auditing.
  if (req.query.includeBlocked !== "true") filter.status = { $ne: "blocked" };

  const [downloads, total] = await Promise.all([
    Download.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Download.countDocuments(filter),
  ]);

  const existing = new Set(
    (await Video.find({ _id: { $in: downloads.map((d) => d.video).filter(Boolean) } }).select("_id").lean()).map((v) => v._id.toString())
  );

  res.json({
    success: true,
    downloads: downloads.map((d) => ({ ...serializeDownload(d), videoAvailable: Boolean(d.video && existing.has(d.video.toString())) })),
    page,
    total,
    quota: await quotaSummary(req.user),
  });
});

// ============================================================
// GET /api/downloads/quota
// ============================================================

exports.getQuota = asyncHandler(async (req, res) => {
  await cleanUpStale(req.user._id);
  res.json({ success: true, quota: await quotaSummary(req.user) });
});

// ============================================================
// DEVICES
// ============================================================

exports.listDevices = asyncHandler(async (req, res) => {
  const devices = await DeviceSession.find({ user: req.user._id, trusted: true }).sort({ registeredAt: 1 }).lean();
  const { plan } = effectivePlan(req.user);
  res.json({
    success: true,
    required: REQUIRE_REGISTERED_DEVICE,
    limit: DOWNLOAD_PLANS[plan].maxDevices,
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      browser: d.browser,
      os: d.os,
      deviceType: d.deviceType,
      registeredAt: d.registeredAt || d.createdAt,
      lastUsedAt: d.lastUsedAt,
      current: d.deviceId === req.device?.deviceId,
    })),
  });
});

exports.deleteDevice = asyncHandler(async (req, res) => {
  const result = await removeDevice(req.user._id, String(req.params.deviceId));
  if (!result.ok) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true });
});

// ============================================================
// ADMIN AUDIT — GET /api/downloads/admin/records
// ============================================================

exports.auditRecords = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  const filter = {};
  if (mongoose.isValidObjectId(req.query.user)) filter.user = req.query.user;
  if (mongoose.isValidObjectId(req.query.video)) filter.video = req.query.video;
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(String(req.query.from));
    if (req.query.to) filter.createdAt.$lte = new Date(String(req.query.to));
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [records, total] = await Promise.all([
    Download.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("user", "name email").lean(),
    Download.countDocuments(filter),
  ]);

  res.json({ success: true, page, total, records });
});
