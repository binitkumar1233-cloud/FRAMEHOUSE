const mongoose = require("mongoose");

// One signed-in browser. The JWT carries the sid, so revoking a session
// signs that browser out even though the token itself has not expired.
const userSessionSchema = new mongoose.Schema(
  {
    sid: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deviceId: String,
    ip: String,
    browserName: String,
    browserVersion: String,
    os: String,
    deviceType: String,
    deviceModel: String,
    location: String,
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: String,
  },
  { timestamps: true }
);

userSessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 86400 });

module.exports = mongoose.model("UserSession", userSessionSchema);
