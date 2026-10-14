const express = require("express");
const bcrypt = require("bcryptjs");
const auth = require("../middleware/auth");
const LoginRecord = require("../models/LoginRecord");
const TrustedDevice = require("../models/TrustedDevice");
const UserSession = require("../models/UserSession");
const User = require("../models/User");
const security = require("../services/loginSecurity");
const { normalizePhone, maskPhone } = require("../services/sms");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(auth);

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value));

// ---------- overview ----------

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const cfg = security.CONFIG();
    const [lastLogin, failed, sessions, devices] = await Promise.all([
      LoginRecord.findOne({ user: req.user._id, event: "login_success" }).sort({ createdAt: -1 }).skip(1).lean(),
      LoginRecord.countDocuments({
        user: req.user._id,
        event: { $in: ["login_failed", "otp_failed", "otp_locked"] },
        createdAt: { $gte: new Date(Date.now() - 30 * 86400 * 1000) },
      }),
      UserSession.countDocuments({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
      TrustedDevice.countDocuments({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
    ]);

    res.json({
      success: true,
      theme: req.user.theme,
      themeSource: req.user.themeSource || "auto",
      email: req.user.email,
      phone: req.user.phone ? maskPhone(req.user.phone) : null,
      lastLogin,
      failedLast30Days: failed,
      activeSessions: sessions,
      trustedDevices: devices,
      trustChoices: cfg.trustChoices,
      trustDefault: cfg.trustedDays,
    });
  })
);

// ---------- theme ----------

// theme: "light" | "dark" pins a choice; "auto" goes back to following the sign-in time.
router.put(
  "/theme",
  asyncHandler(async (req, res) => {
    const { theme } = req.body;
    if (!["light", "dark", "auto"].includes(theme)) {
      return res.status(400).json({ success: false, message: "Theme must be light, dark or auto." });
    }

    if (theme === "auto") {
      req.user.themeSource = "auto";
      req.user.theme = security.themeForTime();
    } else {
      req.user.themeSource = "manual";
      req.user.theme = theme;
    }
    await req.user.save();

    res.json({ success: true, theme: req.user.theme, themeSource: req.user.themeSource });
  })
);

// ---------- mobile number ----------

// An empty phone removes the number. Changing it needs the current password.
router.put(
  "/phone",
  asyncHandler(async (req, res) => {
    const { phone, currentPassword } = req.body;
    if (typeof currentPassword !== "string") {
      return res.status(400).json({ success: false, message: "Enter your current password." });
    }

    const remove = typeof phone !== "string" || phone.trim() === "";
    const normalized = remove ? null : normalizePhone(phone);
    if (!remove && !normalized) {
      return res.status(400).json({ success: false, message: "Enter the mobile number with country code, like +919876543210." });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ success: false, message: "Your current password is incorrect." });
    }

    await User.updateOne({ _id: user._id }, normalized ? { $set: { phone: normalized } } : { $unset: { phone: "" } });
    res.json({ success: true, phone: normalized ? maskPhone(normalized) : null });
  })
);

// ---------- password ----------

router.put(
  "/password",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ success: false, message: "Enter your current and new passwords." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must contain at least 6 characters." });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ success: false, message: "Choose a new password different from your current one." });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ success: false, message: "Your current password is incorrect." });
    }
    const ctx = await security.buildContext(req);

    const password = await bcrypt.hash(newPassword, 10);
    const updated = await User.updateOne(
      { _id: user._id, password: user.password },
      { $set: { password } }
    );
    if (updated.matchedCount !== 1) {
      return res.status(409).json({ success: false, message: "Your password changed during this request. Please try again." });
    }

    let revokedSessions = 0;
    let sessionsRevoked = true;
    try {
      const revoked = await UserSession.updateMany(
        { user: user._id, revokedAt: null, sid: { $ne: req.sessionId } },
        { revokedAt: new Date(), revokedReason: "password changed" }
      );
      revokedSessions = revoked.modifiedCount;
    } catch (error) {
      sessionsRevoked = false;
      console.error("[security] password changed, but other sessions could not be revoked:", error.message);
    }
    await security.record("password_changed", {
      user,
      ctx,
      sessionId: req.sessionId,
      note: sessionsRevoked
        ? `signed out ${revokedSessions} other session(s)`
        : "other sessions could not be signed out",
    });

    res.json({
      success: true,
      revokedSessions,
      sessionsRevoked,
      message: sessionsRevoked
        ? "Password changed successfully."
        : "Password changed, but other sessions could not be signed out. Please sign them out from this page.",
    });
  })
);

// ---------- login history ----------

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { user: req.user._id };

    if (req.query.type === "failed") filter.event = { $in: ["login_failed", "otp_failed", "otp_locked", "otp_expired", "login_blocked"] };
    else if (req.query.type === "success") filter.event = "login_success";

    const [records, total] = await Promise.all([
      LoginRecord.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-userAgent -email -user -__v")
        .lean(),
      LoginRecord.countDocuments(filter),
    ]);

    res.json({ success: true, records, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

// ---------- trusted devices ----------

router.get(
  "/devices",
  asyncHandler(async (req, res) => {
    const currentDeviceId = req.device?.deviceId;
    const devices = await TrustedDevice.find({
      user: req.user._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ trustedAt: -1 })
      .lean();

    res.json({
      success: true,
      devices: devices.map(({ deviceId, ...device }) => ({ ...device, current: deviceId === currentDeviceId })),
    });
  })
);

// Trust the browser that is signed in right now (useful after the very first sign-in).
router.post(
  "/devices/trust",
  asyncHandler(async (req, res) => {
    const ctx = await security.buildContext(req);
    if (!ctx.deviceId) return res.status(400).json({ success: false, message: "This browser can't be identified." });
    const device = await security.trustDevice(req.user, ctx, req.body.days);
    res.json({ success: true, device: { _id: device._id, label: device.label, expiresAt: device.expiresAt } });
  })
);

router.delete(
  "/devices/:id",
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid device" });
    const device = await TrustedDevice.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, revokedAt: null },
      { revokedAt: new Date() }
    );
    if (!device) return res.status(404).json({ success: false, message: "Device not found" });
    await security.record("device_revoked", { user: req.user, ctx: await security.buildContext(req), note: device.label });
    res.json({ success: true });
  })
);

// ---------- sessions ----------

router.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const sessions = await UserSession.find({
      user: req.user._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastSeenAt: -1 })
      .select("-deviceId -__v -user")
      .lean();

    res.json({
      success: true,
      sessions: sessions.map((session) => ({ ...session, current: session.sid === req.sessionId })),
    });
  })
);

router.delete(
  "/sessions/:sid",
  asyncHandler(async (req, res) => {
    const session = await UserSession.findOneAndUpdate(
      { sid: req.params.sid, user: req.user._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: "revoked by user" }
    );
    if (!session) return res.status(404).json({ success: false, message: "Session not found" });
    await security.record("session_revoked", {
      user: req.user,
      ctx: await security.buildContext(req),
      sessionId: req.params.sid,
      note: security.deviceLabel(session),
    });
    res.json({ success: true, current: req.params.sid === req.sessionId });
  })
);

router.post(
  "/sessions/revoke-others",
  asyncHandler(async (req, res) => {
    const result = await UserSession.updateMany(
      { user: req.user._id, revokedAt: null, sid: { $ne: req.sessionId } },
      { revokedAt: new Date(), revokedReason: "revoked by user" }
    );
    if (result.modifiedCount) {
      await security.record("session_revoked", {
        user: req.user,
        ctx: await security.buildContext(req),
        note: `signed out ${result.modifiedCount} other session(s)`,
      });
    }
    res.json({ success: true, revoked: result.modifiedCount });
  })
);

module.exports = router;
