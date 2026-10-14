const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const LoginRecord = require("../models/LoginRecord");
const OtpChallenge = require("../models/OtpChallenge");
const TrustedDevice = require("../models/TrustedDevice");
const UserSession = require("../models/UserSession");
const { lookupIp } = require("./geoip");
const { sendMail } = require("./mailer");
const { otpEmail } = require("./emailTemplates");
const { ensureUsername } = require("./username");

const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

const CONFIG = () => ({
  otpMinutes: num(process.env.OTP_TTL_MINUTES, 10),
  maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
  resendSeconds: num(process.env.OTP_RESEND_SECONDS, 30),
  maxResends: num(process.env.OTP_MAX_RESENDS, 3),
  trustedDays: num(process.env.TRUSTED_DEVICE_DAYS, 30),
  // Days a user may pick when trusting a browser.
  trustChoices: [7, 30, 90],
  sessionDays: 7,
  maxFailedLogins: num(process.env.MAX_FAILED_LOGINS, 8),
  failedWindowMinutes: 15,
});

// ---------- theme ----------

/** Light between 5:00 AM and 12:00 PM IST, dark the rest of the day. */
const themeForTime = (now = new Date()) => {
  const istHour = new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours();
  return istHour >= 5 && istHour < 12 ? "light" : "dark";
};

// ---------- request context ----------

const buildContext = async (req) => {
  const d = req.device || {};
  const geo = await lookupIp(d.ip);
  return {
    ip: geo.ip || d.ip,
    deviceId: d.deviceId,
    userAgent: String(d.userAgent || "").slice(0, 300),
    browserName: d.browserName,
    browserVersion: d.browserVersion,
    os: d.os,
    deviceType: d.deviceType,
    deviceModel: d.deviceModel,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    location: geo.location,
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
};

const deviceLabel = (ctx) =>
  [ctx.browserName, ctx.browserVersion ? ctx.browserVersion.split(".")[0] : ""].filter(Boolean).join(" ") +
  (ctx.os ? ` on ${ctx.os}` : "");

// ---------- audit log ----------

const record = (event, { user, email, ctx = {}, reasons = [], sessionId, note } = {}) =>
  LoginRecord.create({
    user: user?._id || user,
    email: email || user?.email,
    event,
    reasons,
    note,
    sessionId,
    ...ctx,
  }).catch((error) => console.error("[security] could not write log:", error.message));

// ---------- risk check ----------

/**
 * Decides whether this sign-in needs an OTP. A browser the user trusted skips
 * it. Otherwise a new device, browser, IP address, or city/state triggers it.
 * The very first sign-in has nothing to compare against, so it sets the baseline.
 */
const assessLogin = async (user, ctx) => {
  const trusted = ctx.deviceId
    ? await TrustedDevice.findOne({
        user: user._id,
        deviceId: ctx.deviceId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
    : null;

  if (trusted) return { required: false, reasons: [], trusted };

  // A browser whose trust was removed or ran out has to prove itself again.
  const lapsed = ctx.deviceId
    ? await TrustedDevice.exists({ user: user._id, deviceId: ctx.deviceId })
    : null;

  const past = await LoginRecord.find({ user: user._id, event: "login_success" })
    .sort({ createdAt: -1 })
    .limit(300)
    .select("deviceId browserName ip city region")
    .lean();

  if (past.length === 0) return { required: false, reasons: [], baseline: true };

  const reasons = [];
  if (lapsed) reasons.push("trust_expired");
  if (!ctx.deviceId || !past.some((p) => p.deviceId === ctx.deviceId)) reasons.push("new_device");
  if (!past.some((p) => p.browserName === ctx.browserName)) reasons.push("new_browser");
  if (!past.some((p) => p.ip === ctx.ip)) reasons.push("new_ip");
  // Only compared when the IP could be placed on a map.
  if (ctx.city || ctx.region) {
    const seen = past.some((p) => (p.city || "") === (ctx.city || "") && (p.region || "") === (ctx.region || ""));
    if (!seen && past.some((p) => p.city || p.region)) reasons.push("new_location");
  }

  return { required: reasons.length > 0, reasons };
};

// ---------- OTP ----------

const hashCode = (challengeId, code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${challengeId}:${code}`).digest("hex");

const maskEmail = (email = "") => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`;
};

const deliverCode = async (user, code, ctx, reasons) => {
  const { otpMinutes } = CONFIG();
  const mail = otpEmail({ user, code, minutes: otpMinutes, ctx, reasons });
  try {
    await sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (error) {
    console.error("[security] could not send OTP email:", error.message);
  }
};

const startChallenge = async (user, ctx, reasons) => {
  const cfg = CONFIG();
  const challengeId = crypto.randomBytes(24).toString("hex");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  await OtpChallenge.create({
    challengeId,
    user: user._id,
    codeHash: hashCode(challengeId, code),
    reasons,
    deviceId: ctx.deviceId,
    ip: ctx.ip,
    expiresAt: new Date(Date.now() + cfg.otpMinutes * 60 * 1000),
  });

  await deliverCode(user, code, ctx, reasons);
  await record("otp_sent", { user, ctx, reasons });

  return {
    challengeId,
    maskedEmail: maskEmail(user.email),
    expiresInSeconds: cfg.otpMinutes * 60,
    resendAfterSeconds: cfg.resendSeconds,
    reasons,
  };
};

const resendChallenge = async (challengeId, user, ctx) => {
  const cfg = CONFIG();
  const challenge = await OtpChallenge.findOne({ challengeId, user: user._id });
  if (!challenge || challenge.consumedAt || challenge.lockedAt || challenge.expiresAt < new Date()) {
    return { ok: false, status: 400, message: "This code has expired. Please sign in again." };
  }
  const waited = (Date.now() - challenge.lastSentAt.getTime()) / 1000;
  if (waited < cfg.resendSeconds) {
    return { ok: false, status: 429, message: `Please wait ${Math.ceil(cfg.resendSeconds - waited)} seconds before requesting another code.` };
  }
  if (challenge.resends >= cfg.maxResends) {
    return { ok: false, status: 429, message: "Too many codes requested. Please sign in again later." };
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  challenge.codeHash = hashCode(challenge.challengeId, code);
  challenge.resends += 1;
  challenge.attempts = 0;
  challenge.lastSentAt = new Date();
  await challenge.save();

  await deliverCode(user, code, ctx, challenge.reasons);
  await record("otp_sent", { user, ctx, reasons: challenge.reasons, note: "resend" });
  return { ok: true, resendAfterSeconds: cfg.resendSeconds };
};

const verifyChallenge = async (challengeId, code, ctx) => {
  const cfg = CONFIG();
  const challenge = await OtpChallenge.findOne({ challengeId });

  if (!challenge || challenge.consumedAt) {
    return { ok: false, status: 400, message: "This verification is no longer valid. Please sign in again." };
  }
  if (challenge.deviceId && challenge.deviceId !== ctx.deviceId) {
    return { ok: false, status: 400, message: "This code was requested from a different browser." };
  }
  if (challenge.lockedAt) {
    return { ok: false, status: 429, message: "Too many incorrect codes. Please sign in again.", challenge };
  }
  if (challenge.expiresAt < new Date()) {
    return { ok: false, status: 400, message: "This code has expired. Request a new one.", expired: true, challenge };
  }

  const expected = Buffer.from(hashCode(challenge.challengeId, String(code || "").trim()));
  const actual = Buffer.from(challenge.codeHash);
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!match) {
    // Atomic increment so parallel guesses cannot beat the attempt limit.
    const updated = await OtpChallenge.findOneAndUpdate(
      { _id: challenge._id },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" }
    );
    if (updated.attempts >= cfg.maxAttempts) {
      await OtpChallenge.updateOne({ _id: challenge._id }, { lockedAt: new Date() });
      return { ok: false, status: 429, message: "Too many incorrect codes. Please sign in again.", locked: true, challenge };
    }
    return {
      ok: false,
      status: 401,
      message: `Incorrect code. ${cfg.maxAttempts - updated.attempts} attempt${cfg.maxAttempts - updated.attempts === 1 ? "" : "s"} left.`,
      challenge,
    };
  }

  // Single use: only the request that flips consumedAt succeeds.
  const consumed = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: { $exists: false } },
    { consumedAt: new Date() },
    { returnDocument: "after" }
  );
  if (!consumed) return { ok: false, status: 400, message: "This verification is no longer valid. Please sign in again." };

  return { ok: true, challenge: consumed };
};

// ---------- trusted devices ----------

const trustDevice = async (user, ctx, days) => {
  const cfg = CONFIG();
  if (!ctx.deviceId) return null;
  const chosen = cfg.trustChoices.includes(Number(days)) ? Number(days) : cfg.trustedDays;
  const expiresAt = new Date(Date.now() + chosen * 86400 * 1000);

  const device = await TrustedDevice.findOneAndUpdate(
    { user: user._id, deviceId: ctx.deviceId },
    {
      label: deviceLabel(ctx),
      browserName: ctx.browserName,
      browserVersion: ctx.browserVersion,
      os: ctx.os,
      deviceType: ctx.deviceType,
      deviceModel: ctx.deviceModel,
      ip: ctx.ip,
      location: ctx.location,
      trustedAt: new Date(),
      expiresAt,
      lastUsedAt: new Date(),
      revokedAt: null,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  await record("device_trusted", { user, ctx, note: `${chosen} days` });
  return device;
};

// ---------- sessions & tokens ----------

const startSession = async (user, ctx) => {
  const cfg = CONFIG();
  const sid = crypto.randomBytes(16).toString("hex");
  await UserSession.create({
    sid,
    user: user._id,
    deviceId: ctx.deviceId,
    ip: ctx.ip,
    browserName: ctx.browserName,
    browserVersion: ctx.browserVersion,
    os: ctx.os,
    deviceType: ctx.deviceType,
    deviceModel: ctx.deviceModel,
    location: ctx.location,
    expiresAt: new Date(Date.now() + cfg.sessionDays * 86400 * 1000),
  });

  const token = jwt.sign({ userId: user._id, role: user.role, sid }, process.env.JWT_SECRET, {
    expiresIn: `${cfg.sessionDays}d`,
  });
  return { token, sid };
};

/** Completes a sign-in: theme, trusted-device touch, session, token and log entry. */
const completeLogin = async (user, ctx, { trusted, trustDays, wantTrust, reasons = [] } = {}) => {
  await ensureUsername(user);
  if (user.themeSource !== "manual") user.theme = themeForTime();
  await user.save();

  if (wantTrust) await trustDevice(user, ctx, trustDays);
  else if (trusted) await TrustedDevice.updateOne({ _id: trusted._id }, { lastUsedAt: new Date() });

  const { token, sid } = await startSession(user, ctx);
  await record("login_success", { user, ctx, reasons, sessionId: sid });
  return { token, sid };
};

const isSessionActive = async (sid) => {
  if (!sid) return true; // tokens issued before sessions existed
  const session = await UserSession.findOne({ sid }).select("revokedAt expiresAt lastSeenAt").lean();
  if (!session || session.revokedAt || session.expiresAt < new Date()) return false;
  // Keep "last active" fresh without writing on every request.
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60 * 1000) {
    UserSession.updateOne({ sid }, { lastSeenAt: new Date() }).catch(() => {});
  }
  return true;
};

const tooManyFailures = async (email) => {
  const cfg = CONFIG();
  const since = new Date(Date.now() - cfg.failedWindowMinutes * 60 * 1000);
  const count = await LoginRecord.countDocuments({ email, event: "login_failed", createdAt: { $gte: since } });
  return count >= cfg.maxFailedLogins;
};

module.exports = {
  CONFIG,
  themeForTime,
  buildContext,
  record,
  assessLogin,
  startChallenge,
  resendChallenge,
  verifyChallenge,
  trustDevice,
  completeLogin,
  startSession,
  isSessionActive,
  tooManyFailures,
  deviceLabel,
};
