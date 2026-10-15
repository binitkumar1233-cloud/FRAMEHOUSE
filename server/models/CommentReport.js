const mongoose = require("mongoose");

const { Schema } = mongoose;

const REASONS = ["spam", "harassment", "offensive", "hate", "misinformation", "other"];

const commentReportSchema = new Schema(
  {
    comment: { type: Schema.Types.ObjectId, ref: "Comment", required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: REASONS, required: true },
    details: { type: String, maxlength: 500 },
    // What the comment said when it was reported, in case it is edited or deleted later.
    textSnapshot: String,
    status: { type: String, enum: ["open", "dismissed", "actioned"], default: "open", index: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    resolutionNote: String,
  },
  { timestamps: true }
);

// One report per person per comment.
commentReportSchema.index({ comment: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model("CommentReport", commentReportSchema);
module.exports.REASONS = REASONS;
