const mongoose = require("mongoose");

// Simple key/value settings an admin can change from the website.
const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SiteSetting || mongoose.model("SiteSetting", siteSettingSchema);
