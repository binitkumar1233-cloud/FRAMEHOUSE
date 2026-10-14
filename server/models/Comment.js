const mongoose = require("mongoose");

const { Schema } = mongoose;

const commentSchema = new Schema(
  {
    video: { type: Schema.Types.ObjectId, ref: "Video", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Top-level comment this one belongs to (replies are one level deep) and who it answers.
    parent: { type: Schema.Types.ObjectId, ref: "Comment", default: null, index: true },
    replyTo: { type: Schema.Types.ObjectId, ref: "User", default: null },

    text: { type: String, required: true, maxlength: 1500 },
    textHash: { type: String, index: true },
    language: { type: String, default: "und" }, // best guess from the writing system
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Snapshot of where the author signed in from when they posted (city + country only).
    location: { city: String, country: String },

    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    dislikes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    likeCount: { type: Number, default: 0 },
    dislikeCount: { type: Number, default: 0 },
    replyCount: { type: Number, default: 0 },

    // Bumped on every edit; edits must quote the version they were based on.
    version: { type: Number, default: 1 },
    editedAt: Date,
    history: [{ text: String, editedAt: Date, version: Number, _id: false }],

    // A report only flags a comment for review. Dislikes never remove anything.
    reportCount: { type: Number, default: 0 },
    flagged: { type: Boolean, default: false, index: true },

    // visible | removed (by a moderator). Authors' deletes set deletedAt instead.
    status: { type: String, enum: ["visible", "removed"], default: "visible" },
    deletedAt: Date,
    removedAt: Date,
    removedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

commentSchema.index({ video: 1, parent: 1, createdAt: -1 });

module.exports = mongoose.model("Comment", commentSchema);
