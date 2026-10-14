const mongoose = require("mongoose");

const { Schema } = mongoose;

// Every automatic block and every moderator decision.
const moderationLogSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ["auto_blocked", "report_filed", "report_dismissed", "comment_removed", "comment_restored", "comment_deleted_by_author", "comment_edited"],
      index: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: "User" }, // moderator, or the author for self-service actions
    targetUser: { type: Schema.Types.ObjectId, ref: "User", index: true },
    comment: { type: Schema.Types.ObjectId, ref: "Comment", index: true },
    report: { type: Schema.Types.ObjectId, ref: "CommentReport" },
    video: { type: Schema.Types.ObjectId, ref: "Video" },
    code: String, // e.g. profanity, duplicate, link, flood
    detail: String,
    excerpt: String, // short copy of the text involved
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

moderationLogSchema.index({ targetUser: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("ModerationLog", moderationLogSchema);
