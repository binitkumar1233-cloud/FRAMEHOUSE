const mongoose = require("mongoose");

// Translations are cached per comment version, so an edit never serves a stale translation.
const translationSchema = new mongoose.Schema(
  {
    comment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", required: true },
    version: { type: Number, required: true },
    target: { type: String, required: true },
    text: { type: String, required: true },
    detectedLanguage: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

translationSchema.index({ comment: 1, version: 1, target: 1 }, { unique: true });
translationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });

module.exports = mongoose.model("CommentTranslation", translationSchema);
