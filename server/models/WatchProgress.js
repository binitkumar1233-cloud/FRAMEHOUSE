const mongoose = require("mongoose");

const watchProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
    },
    progress: {
      type: Number,
      default: 0,
    },
    duration: {
      type: Number,
      default: 0,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

watchProgressSchema.index({ user: 1, video: 1 }, { unique: true });

module.exports = mongoose.model("WatchProgress", watchProgressSchema);
