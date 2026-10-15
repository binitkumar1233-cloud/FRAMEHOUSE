const mongoose = require("mongoose");

const deviceSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    ip: String,
    userAgent: String,
    browser: String,
    os: String,
    deviceType: String,
    location: String,
    // true = registered for downloads.
    trusted: {
      type: Boolean,
      default: false,
    },
    registeredAt: Date,
    removedAt: Date,
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

deviceSessionSchema.index({ user: 1, deviceId: 1 }, { unique: true });

module.exports = mongoose.model("DeviceSession", deviceSessionSchema);
