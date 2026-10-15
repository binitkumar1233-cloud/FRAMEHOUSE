const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    category: {
      type: String,
      required: true,
    },

    thumbnail: {
      type: String,
      required: true,
    },

    videoUrl: {
      type: String,
      required: true,
    },

    duration: {
      type: String,
      default: "00:00",
    },

    views: {
      type: Number,
      default: 0,
    },

    premium: {
      type: Boolean,
      default: false,
    },

    // Lowest plan that can watch this video. "Gold" = exclusive course.
    // Older videos without it fall back to premium ? "Bronze" : "Free".
    minPlan: {
      type: String,
      enum: ["Free", "Bronze", "Silver", "Gold"],
    },

    // Until this date only Silver and Gold members can watch (early access).
    earlyAccessUntil: {
      type: Date,
      default: null,
    },

    // Optional extra renditions. The best one allowed by the viewer's plan
    // is served; videoUrl is used when none fits.
    sources: [
      {
        _id: false,
        quality: { type: Number, enum: [360, 480, 720, 1080, 2160] },
        url: String,
      },
    ],

    captions: [
      {
        _id: false,
        language: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        default: { type: Boolean, default: false },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Video", videoSchema);
