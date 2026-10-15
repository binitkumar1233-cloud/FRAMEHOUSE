const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Optional mobile number in E.164 format (+919876543210). Sign-in codes are also texted here.
    phone: {
      type: String,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    // Public handle used for @mentions. Created automatically the first time it is needed.
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]{3,20}$/,
    },

    avatar: { type: String, default: "" },

    // Language comments are translated into.
    preferredLanguage: { type: String, default: "en" },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    subscriptionPlan: {
      type: String,
      enum: ["Free", "Bronze", "Silver", "Gold"],
      default: "Free",
    },

    subscriptionExpiry: {
      type: Date,
      default: null,
    },

    subscriptionStart: {
      type: Date,
      default: null,
    },

    subscriptionCycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", null],
      default: null,
    },

    // active: paid and running · cancelled: runs until expiry, then Free ·
    // expired: moved back to Free · none: never subscribed.
    subscriptionStatus: {
      type: String,
      enum: ["none", "active", "cancelled", "expired"],
      default: "none",
    },

    // Plan the user chose to move down to when the current one ends.
    pendingPlan: {
      type: String,
      enum: ["Free", "Bronze", "Silver", "Gold", null],
      default: null,
    },

    previousPlan: {
      type: String,
      default: null,
    },

    // Expiry date a reminder / expiry email was already sent for (prevents duplicates).
    reminderSentFor: {
      type: Date,
      default: null,
    },

    expiryNoticeSentFor: {
      type: Date,
      default: null,
    },

    theme: {
      type: String,
      enum: ["light", "dark"],
      default: "dark",
    },

    // auto: follows the sign-in time (light 5 AM-12 PM IST, otherwise dark) · manual: the user picked one.
    themeSource: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
