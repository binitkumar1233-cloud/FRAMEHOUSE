const mongoose = require("mongoose");

const passwordResetChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    requestedIp: String,
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
    lockedAt: Date,
  },
  { timestamps: true }
);

passwordResetChallengeSchema.index({ expiresAt:  1 }, { expireAfterSeconds: 3600 });
passwordResetChallengeSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("PasswordResetChallenge", passwordResetChallengeSchema);
