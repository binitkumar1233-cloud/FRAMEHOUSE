const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const OtpChallenge = require("../models/OtpChallenge");
const PasswordResetChallenge = require("../models/PasswordResetChallenge");
const UserSession = require("../models/UserSession");
const TrustedDevice = require("../models/TrustedDevice");
const security = require("../services/loginSecurity");
const { sendMail } = require("../services/mailer");
const { passwordResetEmail } = require("../services/emailTemplates");

const router = express.Router();

// ==================== REGISTER ====================

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 6 characters",
      });
    }

    const existingUser = await User.findOne({
      email: email.toLowerCase(),
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
    });

    res.status(201).json({
      success: true,
      message: "Registration successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        subscriptionPlan: user.subscriptionPlan,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ==================== LOGIN ====================

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  subscriptionPlan: user.subscriptionPlan,
  theme: user.theme,
  themeSource: user.themeSource,
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const ctx = await security.buildContext(req);
    const normalizedEmail = email.toLowerCase().trim();

    if (await security.tooManyFailures(normalizedEmail)) {
      await security.record("login_blocked", { email: normalizedEmail, ctx, note: "too many failed attempts" });
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please wait a few minutes and try again.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    const passwordMatch = user ? await bcrypt.compare(password, user.password) : false;

    if (!user || !passwordMatch) {
      await security.record("login_failed", { user, email: normalizedEmail, ctx, note: user ? "wrong password" : "unknown email" });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const risk = await security.assessLogin(user, ctx);

    if (risk.required) {
      const challenge = await security.startChallenge(user, ctx, risk.reasons);
      return res.json({
        success: true,
        otpRequired: true,
        message: "Enter the code we emailed you to finish signing in.",
        ...challenge,
        trustChoices: security.CONFIG().trustChoices,
        trustDefault: security.CONFIG().trustedDays,
      });
    }

    const { token } = await security.completeLogin(user, ctx, { trusted: risk.trusted });

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Second step when a new browser, device, IP or location was detected.
router.post("/login/verify", async (req, res) => {
  try {
    const { challengeId, code, trustDevice, trustDays } = req.body;

    if (typeof challengeId !== "string" || !/^\d{6}$/.test(String(code || "").trim())) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit code." });
    }

    const ctx = await security.buildContext(req);
    const result = await security.verifyChallenge(challengeId, code, ctx);

    if (!result.ok) {
      if (result.challenge) {
        const event = result.locked ? "otp_locked" : result.expired ? "otp_expired" : "otp_failed";
        await security.record(event, { user: result.challenge.user, ctx, reasons: result.challenge.reasons });
      }
      return res.status(result.status).json({ success: false, message: result.message, locked: Boolean(result.locked), expired: Boolean(result.expired) });
    }

    const user = await User.findById(result.challenge.user);
    if (!user) return res.status(401).json({ success: false, message: "Account not found" });

    await security.record("otp_verified", { user, ctx, reasons: result.challenge.reasons });
    const { token } = await security.completeLogin(user, ctx, {
      wantTrust: Boolean(trustDevice),
      trustDays,
      reasons: result.challenge.reasons,
    });

    res.json({ success: true, message: "Login successful", token, user: publicUser(user) });
  } catch (error) {
    console.error("OTP verify error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/login/resend", async (req, res) => {
  try {
    const { challengeId } = req.body;
    if (typeof challengeId !== "string") {
      return res.status(400).json({ success: false, message: "Missing verification" });
    }

    const challenge = await OtpChallenge.findOne({ challengeId });
    const user = challenge ? await User.findById(challenge.user) : null;
    if (!user) {
      return res.status(400).json({ success: false, message: "This verification is no longer valid. Please sign in again." });
    }

    const ctx = await security.buildContext(req);
    if (challenge.deviceId && challenge.deviceId !== ctx.deviceId) {
      return res.status(400).json({ success: false, message: "This code was requested from a different browser." });
    }

    const result = await security.resendChallenge(challengeId, user, ctx);
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    res.json({ success: true, message: "A new code was sent.", resendAfterSeconds: result.resendAfterSeconds });
  } catch (error) {
    console.error("OTP resend error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- FORGOT PASSWORD ----------

const RESET_CODE_MINUTES = 10;
const RESET_REQUESTS_PER_HOUR = 5;
const hashResetCode = (challengeId, code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${challengeId}:${code}`).digest("hex");

router.post("/password/forgot", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    const ip = req.device?.ip || req.ip || "unknown";
    const requestsThisHour = await PasswordResetChallenge.countDocuments({
      requestedIp: ip,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
    });
    if (requestsThisHour >= RESET_REQUESTS_PER_HOUR) {
      return res.status(429).json({ success: false, message: "Too many reset requests. Please try again later." });
    }

    const challengeId = crypto.randomBytes(32).toString("hex");
    const user = await User.findOne({ email });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    await PasswordResetChallenge.create({
      challengeId,
      user: user?._id,
      codeHash: hashResetCode(challengeId, code),
      requestedIp: ip,
      expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000),
    });
    if (user) {
      const mail = passwordResetEmail({ user, code, minutes: RESET_CODE_MINUTES });
      await sendMail({ to: user.email, ...mail });
    }

    res.json({
      success: true,
      challengeId,
      message: "If an account exists for that email, a password reset code has been sent.",
      expiresInSeconds: RESET_CODE_MINUTES * 60,
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    res.status(500).json({ success: false, message: "Unable to request a password reset right now." });
  }
});

router.post("/password/reset", async (req, res) => {
  try {
    const { challengeId, code, newPassword } = req.body;
    if (typeof challengeId !== "string" || !/^[a-f\d]{64}$/i.test(challengeId) ||
        typeof code !== "string" || !/^\d{6}$/.test(code) ||
        typeof newPassword !== "string") {
      return res.status(400).json({ success: false, message: "Enter the reset code and a new password." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must contain at least 6 characters." });
    }

    const challenge = await PasswordResetChallenge.findOne({
      challengeId,
      consumedAt: null,
      lockedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) {
      return res.status(400).json({ success: false, message: "This reset code is invalid or expired. Request a new one." });
    }

    const expected = Buffer.from(hashResetCode(challengeId, code));
    const actual = Buffer.from(challenge.codeHash);
    const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!valid) {
      const updatedChallenge = await PasswordResetChallenge.findOneAndUpdate(
        { _id: challenge._id, consumedAt: null, lockedAt: null, attempts: { $lt: 4 } },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" }
      );
      if (updatedChallenge?.attempts >= 4) {
        await PasswordResetChallenge.updateOne({ _id: challenge._id, lockedAt: null }, { $set: { lockedAt: new Date() } });
      }
      return res.status(400).json({ success: false, message: "The reset code is incorrect or expired." });
    }

    const claimed = await PasswordResetChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, lockedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 4 } },
      { $set: { consumedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!claimed) {
      return res.status(400).json({ success: false, message: "This reset code is invalid or expired. Request a new one." });
    }

    const password = await bcrypt.hash(newPassword, 10);
    const user = await User.findByIdAndUpdate(challenge.user, { $set: { password } });
    if (!user) {
      return res.status(400).json({ success: false, message: "This account is no longer available." });
    }

    const now = new Date();
    let revokedSessions = 0;
    let revokedDevices = 0;
    let securityCleanupComplete = true;
    try {
      const sessions = await UserSession.updateMany(
        { user: user._id, revokedAt: null },
        { $set: { revokedAt: now, revokedReason: "password reset" } }
      );
      revokedSessions = sessions.modifiedCount;
    } catch (error) {
      securityCleanupComplete = false;
      console.error("[security] password reset completed, but sessions could not be revoked:", error.message);
    }
    try {
      const devices = await TrustedDevice.updateMany(
        { user: user._id, revokedAt: null },
        { $set: { revokedAt: now } }
      );
      revokedDevices = devices.modifiedCount;
    } catch (error) {
      securityCleanupComplete = false;
      console.error("[security] password reset completed, but trusted devices could not be revoked:", error.message);
    }
    await security.record("password_changed", {
      user,
      ctx: { ip: req.device?.ip || req.ip },
      note: `password reset; signed out ${revokedSessions} session(s) and revoked ${revokedDevices} trusted device(s)`,
    });

    res.json({
      success: true,
      message: securityCleanupComplete
        ? "Password reset successfully. Sign in with your new password."
        : "Password reset, but we couldn't revoke every trusted browser or session. Contact support if you need help securing your account.",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ success: false, message: "Unable to reset your password right now." });
  }
});

router.post("/logout", protect, async (req, res) => {
  try {
    if (req.sessionId) {
      const session = await UserSession.findOneAndUpdate(
        { sid: req.sessionId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: "logout" }
      );
      if (session) await security.record("logout", { user: req.user.userId, email: undefined, ctx: await security.buildContext(req), sessionId: req.sessionId });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== PROTECTED PROFILE ====================

router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Profile error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
