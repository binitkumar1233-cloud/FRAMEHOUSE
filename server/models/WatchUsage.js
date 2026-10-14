const mongoose = require("mongoose");

// Seconds watched per user per day, for plans with a daily watch limit.
// Measured with server time between player heartbeats, so it can't be inflated.
const watchUsageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    dayKey: { type: String, required: true },
    seconds: { type: Number, default: 0 },
    lastBeatAt: Date,
  },
  { timestamps: true }
);

watchUsageSchema.index({ user: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model("WatchUsage", watchUsageSchema);
