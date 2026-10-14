const mongoose = require("mongoose");

// One row per security event: every attempt, OTP step and sign-out.
const loginRecordSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    // Kept even when no account matched, so attacks on unknown emails are visible too.
    email: { type: String, lowercase: true, trim: true },

    event: {
      type: String,
      required: true,
      enum: [
        "login_success",
        "login_failed",
        "otp_sent",
        "otp_verified",
        "otp_failed",
        "otp_locked",
        "otp_expired",
        "device_trusted",
        "device_revoked",
        "session_revoked",
        "logout",
        "login_blocked",
        "password_changed",
      ],
    },
    reasons: [String], // why OTP was required: new_device, new_browser, new_ip, new_location
    note: String,

    sessionId: String,
    deviceId: String,
    ip: String,
    userAgent: String,
    browserName: String,
    browserVersion: String,
    os: String,
    deviceType: String,
    deviceModel: String,

    city: String,
    region: String,
    country: String,
    location: String, // "Mumbai, Maharashtra, India" or "Local network"
    latitude: Number,
    longitude: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginRecordSchema.index({ user: 1, createdAt: -1 });
loginRecordSchema.index({ email: 1, event: 1, createdAt: -1 });
// History is kept for a year by default.
loginRecordSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: (Number(process.env.LOGIN_HISTORY_DAYS) || 365) * 86400 }
);

module.exports = mongoose.model("LoginRecord", loginRecordSchema);
