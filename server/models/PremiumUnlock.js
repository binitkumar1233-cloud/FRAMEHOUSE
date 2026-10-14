const mongoose = require("mongoose");

// A premium video a Free user chose to unlock with their monthly allowance.
const premiumUnlockSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    monthKey: { type: String, required: true },
  },
  { timestamps: true }
);

premiumUnlockSchema.index({ user: 1, video: 1, monthKey: 1 }, { unique: true });
premiumUnlockSchema.index({ user: 1, monthKey: 1 });

module.exports = mongoose.model("PremiumUnlock", premiumUnlockSchema);
