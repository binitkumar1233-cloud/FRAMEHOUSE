const mongoose = require("mongoose");

const commentEditHistorySchema = new mongoose.Schema(
  {
    comment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", required: true },
    version: { type: Number, required: true },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 1500 },
    editedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

commentEditHistorySchema.index({ comment: 1, version: 1 }, { unique: true });

module.exports = mongoose.model("CommentEditHistory", commentEditHistorySchema);
