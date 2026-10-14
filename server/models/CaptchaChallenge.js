const mongoose = require("mongoose");

const captchaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    answerHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    solvedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

captchaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model("CaptchaChallenge", captchaSchema);
