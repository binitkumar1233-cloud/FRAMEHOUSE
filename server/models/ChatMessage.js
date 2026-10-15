const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, maxlength: 200 },
    mimeType: String,
    size: Number,
    // Base64 data URL. Size is capped by the socket handler.
    dataUrl: String,
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    meeting: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meeting",
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    senderName: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    type: {
      type: String,
      enum: ["text", "file", "system"],
      default: "text",
    },
    attachment: attachmentSchema,
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
