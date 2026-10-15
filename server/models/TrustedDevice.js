const mongoose = require("mongoose");

// A browser the user verified with an OTP and chose to trust for a while.
const trustedDeviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deviceId: { type: String, required: true },
    label: String, // "Chrome 126 on Windows"
    browserName: String,
    browserVersion: String,
    os: String,
    deviceType: String,
    deviceModel: String,
    ip: String,
    location: String,
    trustedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    lastUsedAt: Date,
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

trustedDeviceSchema.index({ user: 1, deviceId: 1 });

module.exports = mongoose.model("TrustedDevice", trustedDeviceSchema);
