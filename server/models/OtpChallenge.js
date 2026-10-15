const mongoose = require("mongoose");

// A pending sign-in that needs an emailed code before a token is issued.
const otpChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    codeHash: { type: String, required: true },
    reasons: [String],
    // The browser that started the sign-in; only it may finish it.
    deviceId: String,
    ip: String,
    attempts: { type: Number, default: 0 },
    resends: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    consumedAt: Date,
    lockedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Mongo removes the document shortly after it expires.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model("OtpChallenge", otpChallengeSchema);
