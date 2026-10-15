const mongoose = require("mongoose");

// One event in a download's life, kept for auditing.
const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    event: {
      type: String,
      enum: ["authorized", "reused", "started", "resumed", "completed", "interrupted", "failed", "blocked", "expired", "refunded"],
      required: true,
    },
    detail: String,
    ip: String,
    userAgent: String,
    bytes: Number,
  },
  { _id: false }
);

const downloadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", index: true },

    // Snapshot so the record stays readable if the video changes or is deleted.
    videoTitle: String,
    thumbnail: String,

    // Plan in effect when this download was requested.
    plan: { type: String, enum: ["Free", "Bronze", "Silver", "Gold"], required: true },

    status: {
      type: String,
      enum: ["authorized", "downloading", "completed", "interrupted", "failed", "blocked", "expired"],
      default: "authorized",
      index: true,
    },
    reason: String,

    // Whether this download uses quota. Re-downloads within 24 hours,
    // failed attempts and unused links do not.
    counted: { type: Boolean, default: false },
    dedupOf: { type: mongoose.Schema.Types.ObjectId, ref: "Download" },
    dayKey: { type: String, index: true },
    monthKey: { type: String, index: true },

    fileSize: Number,
    bytesSent: { type: Number, default: 0 },
    contentType: String,
    attempts: { type: Number, default: 0 },

    // Request details for auditing.
    ip: String,
    userAgent: String,
    browser: String,
    browserVersion: String,
    os: String,
    deviceType: String,
    deviceId: String,

    authorizedAt: Date,
    startedAt: Date,
    completedAt: Date,
    lastActivityAt: Date,

    history: [historySchema],
  },
  { timestamps: true }
);

downloadSchema.index({ user: 1, createdAt: -1 });
downloadSchema.index({ user: 1, video: 1, counted: 1, createdAt: -1 });

module.exports = mongoose.model("Download", downloadSchema);
