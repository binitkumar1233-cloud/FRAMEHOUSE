const mongoose = require("mongoose");

const recordingSchema = new mongoose.Schema(
  {
    meeting: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meeting",
      required: true,
    },
    roomId: String,
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["recording", "processing", "ready", "failed"],
      default: "recording",
    },
    // "local": the file was saved on the recording host's device and
    // never uploaded. Only its metadata is stored here.
    storage: {
      type: String,
      enum: ["local", "server"],
      default: "local",
    },
    fileUrl: String,
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Recording", recordingSchema);
