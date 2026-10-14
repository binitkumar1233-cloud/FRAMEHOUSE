const mongoose = require("mongoose");

// Per-user download counter for one day or one month. Incremented with a
// conditional atomic update, so simultaneous requests can't exceed the limit.
const downloadQuotaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    period: { type: String, enum: ["day", "month"], required: true },
    key: { type: String, required: true },
    used: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

downloadQuotaSchema.index({ user: 1, period: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("DownloadQuota", downloadQuotaSchema);
